#!/usr/bin/env ruby
# frozen_string_literal: true

require 'base64'
require 'fileutils'
require 'json'
require 'net/http'
require 'open3'
require 'securerandom'
require 'uri'
require 'webrick'

ROOT_DIR = File.expand_path(__dir__)
PUBLIC_DIR = File.join(ROOT_DIR, 'public')
SERIES_PUBLIC_DIR = File.join(PUBLIC_DIR, 'generated-series')
SERIES_DEFAULT_CLIP_SECONDS = 8
SERIES_DEFAULT_TARGET_SECONDS = 72
SERIES_MIN_TARGET_SECONDS = 60
SERIES_MAX_TARGET_SECONDS = 90
SERIES_MIN_HOST_WORDS = 12
SERIES_VIDEO_RETRY_ATTEMPTS = begin
  parsed = ENV.fetch('SERIES_VIDEO_RETRY_ATTEMPTS', '3').to_i
  parsed >= 1 ? parsed : 3
end
SERIES_AUDIO_FILTER_FALLBACK_MODEL = ENV.fetch('SERIES_AUDIO_FILTER_FALLBACK_MODEL', 'veo-3.1-generate-preview').to_s.strip
DEFAULT_SERIES_HOST_PROMPT = ENV.fetch(
  'DEFAULT_SERIES_HOST_PROMPT',
  'Indian male financial educator in navy-blue shirt seated at a desk in a bright office, clean professional portrait, subtle smile, natural lighting, realistic skin texture.'
).to_s.strip
DEFAULT_SERIES_HOST_IMAGE_GLOB = ENV.fetch('DEFAULT_SERIES_HOST_IMAGE_GLOB', File.join(ROOT_DIR, 'assets', 'host-angle-*')).to_s.strip
SERIES_MAX_WORDS_PER_HOST_CLIP = begin
  parsed = ENV.fetch('SERIES_MAX_WORDS_PER_HOST_CLIP', '18').to_i
  parsed >= 12 ? parsed : 18
end
SERIES_MIN_WORDS_PER_SPLIT_CHUNK = 4

def load_env_file(path)
  return unless File.file?(path)

  File.readlines(path, chomp: true).each do |raw_line|
    line = raw_line.strip
    next if line.empty? || line.start_with?('#')

    key, value = line.split('=', 2)
    next if key.nil? || value.nil?

    key = key.strip
    value = value.strip

    if (value.start_with?('"') && value.end_with?('"')) || (value.start_with?("'") && value.end_with?("'"))
      value = value[1..-2]
    end

    ENV[key] = value unless ENV.key?(key)
  end
end

def read_json_body(request)
  raw = request.body.to_s
  return {} if raw.strip.empty?

  JSON.parse(raw)
rescue JSON::ParserError => e
  raise ArgumentError, "Invalid JSON body: #{e.message}"
end

def nested_get(data, path)
  current = data
  path.each do |part|
    return nil unless current.is_a?(Hash) || current.is_a?(Array)

    if current.is_a?(Array) && part.is_a?(Integer)
      current = current[part]
    elsif current.is_a?(Hash)
      current = current[part]
    else
      return nil
    end
  end
  current
end

def first_present_value(data, paths)
  paths.each do |path|
    value = nested_get(data, path)
    return value unless value.nil? || value == ''
  end
  nil
end

def normalize_url(candidate, base_url)
  return '' unless candidate.is_a?(String)

  raw = candidate.strip
  return '' if raw.empty?
  return raw if raw.start_with?('http://', 'https://', 'data:video/')

  if raw.start_with?('/', './', '../')
    return URI.join(base_url, raw).to_s
  end

  ''
rescue StandardError
  ''
end

def extract_status(data)
  return '' unless data.is_a?(Hash)

  status = first_present_value(
    data,
    [
      ['status'],
      ['state'],
      ['job', 'status'],
      ['data', 'status'],
      ['result', 'status']
    ]
  )

  status.is_a?(String) ? status.strip : ''
end

def extract_error_message(data)
  return '' unless data.is_a?(Hash)

  value = first_present_value(
    data,
    [
      ['error', 'message'],
      ['error'],
      ['message'],
      ['detail'],
      ['details']
    ]
  )

  return value if value.is_a?(String)
  return value['message'] if value.is_a?(Hash) && value['message'].is_a?(String)

  ''
end

def extract_video_result(data, base_url)
  if data.is_a?(String)
    url = normalize_url(data, base_url)
    return { video_url: url, status: 'completed' } unless url.empty?

    return { raw_text: data }
  end

  return {} unless data.is_a?(Hash)

  video_url_candidate = first_present_value(
    data,
    [
      ['videoUrl'],
      ['video_url'],
      ['url'],
      ['result', 'videoUrl'],
      ['result', 'video_url'],
      ['result', 'url'],
      ['data', 'videoUrl'],
      ['data', 'video_url'],
      ['data', 'url'],
      ['output', 0, 'url'],
      ['artifacts', 0, 'url'],
      ['video', 'url']
    ]
  )
  video_url = normalize_url(video_url_candidate, base_url)
  return { video_url: video_url, status: extract_status(data) || 'completed' } unless video_url.empty?

  video_base64 = first_present_value(
    data,
    [
      ['videoBase64'],
      ['video_base64'],
      ['base64'],
      ['result', 'videoBase64'],
      ['result', 'video_base64'],
      ['data', 'videoBase64'],
      ['data', 'video_base64'],
      ['output', 0, 'base64']
    ]
  )

  if video_base64.is_a?(String) && video_base64.size > 100
    mime_type = first_present_value(
      data,
      [
        ['mimeType'],
        ['mime_type'],
        ['contentType'],
        ['content_type']
      ]
    )
    return {
      video_base64: video_base64,
      mime_type: mime_type.is_a?(String) ? mime_type : 'video/mp4',
      status: 'completed'
    }
  end

  poll_url_candidate = first_present_value(
    data,
    [
      ['pollUrl'],
      ['poll_url'],
      ['statusUrl'],
      ['status_url'],
      ['urls', 'status'],
      ['result', 'poll_url']
    ]
  )

  job_id_candidate = first_present_value(
    data,
    [
      ['jobId'],
      ['job_id'],
      ['taskId'],
      ['task_id'],
      ['id'],
      ['request_id'],
      ['requestId']
    ]
  )

  {
    poll_url: normalize_url(poll_url_candidate, base_url),
    job_id: job_id_candidate.nil? ? '' : job_id_candidate.to_s,
    status: extract_status(data),
    error_message: extract_error_message(data),
    raw: data
  }
end

def http_request(method:, url:, token:, timeout_sec:, auth_header:, auth_prefix:, json_body: nil, follow_redirects: false, max_redirects: 5)
  request_method = method.to_s.upcase
  request_class = case request_method
                  when 'POST'
                    Net::HTTP::Post
                  when 'GET'
                    Net::HTTP::Get
                  else
                    raise ArgumentError, "Unsupported HTTP method: #{method}"
                  end

  current_url = url.to_s
  redirects = 0

  loop do
    uri = URI.parse(current_url)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = uri.scheme == 'https'
    http.open_timeout = [timeout_sec, 10].min
    http.read_timeout = timeout_sec

    path = uri.path.empty? ? '/' : uri.path
    path += "?#{uri.query}" if uri.query

    request = request_class.new(path)
    request['Accept'] = 'application/json, video/*, application/octet-stream'
    unless token.to_s.empty?
      request[auth_header] = auth_prefix.to_s.empty? ? token : "#{auth_prefix} #{token}"
    end

    if !json_body.nil? && request_method != 'GET'
      request['Content-Type'] = 'application/json'
      request.body = JSON.generate(json_body)
    end

    response = http.request(request)

    if follow_redirects && response.is_a?(Net::HTTPRedirection)
      location = response['location'].to_s
      raise "Redirect response missing location header for #{current_url}" if location.empty?
      raise "Too many redirects while requesting #{url}" if redirects >= max_redirects

      current_url = URI.join(current_url, location).to_s
      redirects += 1
      next
    end

    content_type = response['content-type'].to_s.downcase
    if content_type.start_with?('video/') || content_type.include?('application/octet-stream')
      return {
        ok: response.code.to_i.between?(200, 299),
        status_code: response.code.to_i,
        kind: :binary_video,
        content_type: response['content-type'] || 'video/mp4',
        body: response.body
      }
    end

    raw_text = response.body.to_s
    parsed = nil
    unless raw_text.strip.empty?
      begin
        parsed = JSON.parse(raw_text)
      rescue JSON::ParserError
        parsed = nil
      end
    end

    return {
      ok: response.code.to_i.between?(200, 299),
      status_code: response.code.to_i,
      kind: :json_or_text,
      data: parsed,
      raw_text: raw_text
    }
  end
end

def status_failed?(status)
  %w[failed error cancelled canceled].include?(status.to_s.downcase)
end

def status_pending?(status)
  %w[queued pending processing running in_progress submitted starting generating].include?(status.to_s.downcase)
end

def build_poll_url(api_url, poll_url, job_id)
  return poll_url unless poll_url.to_s.empty?

  template = ENV.fetch('VIDEO_POLL_URL_TEMPLATE', '').strip
  unless template.empty?
    encoded_job = URI.encode_www_form_component(job_id.to_s)
    return template.gsub('{job_id}', encoded_job)
  end

  return '' if job_id.to_s.empty?

  "#{api_url.sub(%r{/$}, '')}/#{URI.encode_www_form_component(job_id.to_s)}"
end

def normalize_result_for_response(result)
  payload = {}
  payload['status'] = result[:status] unless result[:status].to_s.empty?
  payload['video_url'] = result[:video_url] unless result[:video_url].to_s.empty?
  payload['video_base64'] = result[:video_base64] unless result[:video_base64].to_s.empty?
  payload['mime_type'] = result[:mime_type] unless result[:mime_type].to_s.empty?
  payload['job_id'] = result[:job_id] unless result[:job_id].to_s.empty?
  payload['poll_url'] = result[:poll_url] unless result[:poll_url].to_s.empty?
  payload
end

def parse_boolean(value, default_value = false)
  return value if value == true || value == false
  return default_value if value.nil?

  if value.is_a?(Numeric)
    return value.to_i != 0
  end

  lowered = value.to_s.strip.downcase
  return true if %w[1 true yes y on].include?(lowered)
  return false if %w[0 false no n off].include?(lowered)

  default_value
end

def clamp_integer(value, min_value, max_value, fallback)
  parsed = if value.is_a?(Numeric)
             value.to_i
           else
             value.to_s.strip.empty? ? fallback : value.to_i
           end
  [[parsed, min_value].max, max_value].min
end

def resolve_ffmpeg_bin
  custom = ENV.fetch('FFMPEG_BIN', '').to_s.strip
  return custom unless custom.empty?

  local = File.join(ROOT_DIR, 'node_modules', 'ffmpeg-static', 'ffmpeg')
  return local if File.file?(local)

  'ffmpeg'
end

def normalize_script_text(script)
  squeeze_space(script.to_s)
end

def split_script_into_safe_host_chunks(script, max_words_per_chunk = SERIES_MAX_WORDS_PER_HOST_CLIP)
  normalized = normalize_script_text(script)
  return [] if normalized.empty?

  safe_max_words = [max_words_per_chunk.to_i, 12].max
  sentences = normalized.split(/(?<=[.!?])\s+/).map { |part| squeeze_space(part) }.reject(&:empty?)
  sentences = [normalized] if sentences.empty?

  chunks = []
  current_words = []

  flush_current = lambda do
    return if current_words.empty?

    chunks << squeeze_space(current_words.join(' '))
    current_words.clear
  end

  sentences.each do |sentence|
    sentence_words = sentence.split(' ')

    if sentence_words.length > safe_max_words
      flush_current.call
      sentence_words.each_slice(safe_max_words) do |slice|
        chunk = squeeze_space(slice.join(' '))
        chunks << chunk unless chunk.empty?
      end
      next
    end

    projected_words = current_words.length + sentence_words.length
    if !current_words.empty? && projected_words > safe_max_words
      flush_current.call
    end

    current_words.concat(sentence_words)
  end

  flush_current.call
  chunks.reject(&:empty?)
end

def build_infographic_concept_from_chunk(chunk, fallback_index)
  sentence = chunk.to_s.split(/(?<=[.!?])\s+/).first.to_s
  base = sentence.empty? ? chunk.to_s : sentence
  words = squeeze_space(base).split(' ')
  excerpt = words.first(14).join(' ')
  excerpt = words.first(8).join(' ') if excerpt.empty?
  "Concept #{fallback_index}: #{excerpt}".strip
end

def infographic_relevance_score(text)
  normalized = squeeze_space(text.to_s.downcase)
  return 0 if normalized.empty?

  score = 0

  score += 2 if normalized.match?(/\b\d+(?:\.\d+)?\s*(?:%|percent|x|times?)\b/)
  score += 2 if normalized.match?(/\b(?:rs|inr)\s*[\d,.]+\b|\b[\d,.]+\s*(?:lakh|crore|cr)\b/)
  score += 1 if normalized.match?(/\b(?:vs|versus|compare|compared|higher|lower|increase|decrease|more than|less than)\b/)
  score += 1 if normalized.match?(/\b(?:first|second|third|next|then|finally|step|process|how it works|workflow|journey)\b/)
  score += 1 if normalized.match?(/\b(?:because|therefore|means|refers to|in short|for example|for instance|why)\b/)
  score += 1 if normalized.count(',') >= 2

  finance_term_hits = normalized.scan(
    /\b(?:sip|nav|xirr|irr|cagr|expense ratio|allocation|asset mix|diversification|risk|return|volatility|liquidity|equity|debt|hybrid|tax|inflation|goal|tenure|benchmark|aum)\b/
  ).length
  score += [finance_term_hits, 3].min

  score
end

def pick_relevant_infographic_slots(host_chunks, max_count, threshold = 3)
  return [] if !host_chunks.is_a?(Array) || host_chunks.length <= 1 || max_count <= 0

  scored = host_chunks[0...-1].each_with_index.map do |chunk, index|
    [index, infographic_relevance_score(chunk)]
  end
  scored.sort_by! { |(index, score)| [-score, index] }

  scored.select { |(_index, score)| score >= threshold }.first(max_count).map(&:first)
end

def split_longest_host_chunk_once(chunks, min_words_per_split_chunk = SERIES_MIN_WORDS_PER_SPLIT_CHUNK)
  return false if !chunks.is_a?(Array) || chunks.empty?

  safe_min = [min_words_per_split_chunk.to_i, 2].max
  index = chunks.each_index.max_by { |candidate_index| chunks[candidate_index].split(' ').length }
  return false if index.nil?

  words = chunks[index].split(' ')
  return false if words.length < (safe_min * 2)

  pivot = words.length / 2
  left = squeeze_space(words[0...pivot].join(' '))
  right = squeeze_space(words[pivot..].join(' '))
  return false if left.empty? || right.empty?

  chunks[index] = left
  chunks.insert(index + 1, right)
  true
end

def expand_host_chunks_towards_target(chunks, target_count)
  return chunks unless chunks.is_a?(Array)

  while chunks.length < target_count
    break unless split_longest_host_chunk_once(chunks)
  end
  chunks
end

def build_series_clip_plan(script, total_clips, include_infographics, max_words_per_host_clip = SERIES_MAX_WORDS_PER_HOST_CLIP)
  normalized_script = normalize_script_text(script)
  return [] if normalized_script.empty? || total_clips <= 0

  host_chunks = split_script_into_safe_host_chunks(normalized_script, max_words_per_host_clip)
  return [] if host_chunks.empty?
  return [] if host_chunks.length > total_clips

  if include_infographics
    max_infographics_by_capacity = [total_clips - host_chunks.length, 0].max
    max_infographics_by_share = (total_clips / 2.0).floor
    max_infographics = [max_infographics_by_capacity, max_infographics_by_share].min

    selected_slots = pick_relevant_infographic_slots(host_chunks, max_infographics, 3)
    if selected_slots.length < max_infographics
      host_target = total_clips - selected_slots.length
      expand_host_chunks_towards_target(host_chunks, host_target)
      max_infographics_after_expand = [total_clips - host_chunks.length, 0].max
      selected_slots = pick_relevant_infographic_slots(host_chunks, max_infographics_after_expand, 3)
    end

    insertion_map = {}
    selected_slots.each { |index| insertion_map[index] = true }

    clips = []
    host_chunks.each_with_index do |chunk, host_index|
      clips << {
        'index' => clips.length + 1,
        'type' => 'host',
        'scriptChunk' => chunk
      }

      next unless insertion_map[host_index]

      clips << {
        'index' => clips.length + 1,
        'type' => 'infographic',
        'concept' => build_infographic_concept_from_chunk(chunk, clips.length + 1)
      }
    end

    return clips.first(total_clips)
  end

  expand_host_chunks_towards_target(host_chunks, total_clips)
  host_chunks.first(total_clips).each_with_index.map do |chunk, index|
    {
      'index' => index + 1,
      'type' => 'host',
      'scriptChunk' => chunk
    }
  end
end

def estimate_series_target_duration_seconds(script, clip_duration, include_infographics, max_words_per_host_clip)
  safe_clip_duration = clip_duration.to_i
  safe_clip_duration = SERIES_DEFAULT_CLIP_SECONDS if safe_clip_duration <= 0

  host_chunks = split_script_into_safe_host_chunks(script, max_words_per_host_clip)
  host_count = [host_chunks.length, 1].max

  infographic_count = if include_infographics
                        [((host_count / 3.0).floor), [host_count - 1, 0].max].min
                      else
                        0
                      end

  estimated_seconds = (host_count + infographic_count) * safe_clip_duration
  minimum_seconds = [[host_count * safe_clip_duration, SERIES_MIN_TARGET_SECONDS].max, SERIES_MAX_TARGET_SECONDS].min

  estimated = [[estimated_seconds, SERIES_MIN_TARGET_SECONDS].max, SERIES_MAX_TARGET_SECONDS].min
  [estimated, minimum_seconds].max
end

def sanitize_dialogue_for_prompt(script_chunk)
  script_chunk.to_s.gsub(/["“”]/, "'").strip
end

def build_series_host_video_prompt(series_title, script_chunk, clip_index, total_clips, clip_seconds, instructions = '')
  safe_dialogue = sanitize_dialogue_for_prompt(script_chunk)
  word_count = safe_dialogue.split(' ').length
  instruction_text = squeeze_space(instructions.to_s)
  prompt = [
    "#{clip_seconds}-second vertical 9:16 educational video segment #{clip_index}/#{total_clips} for \"#{series_title}\".",
    'Use the same approved presenter identity and wardrobe continuity from the reference image.',
    'Single location, single continuous action, front-facing direct eye contact, natural Indian-English delivery.',
    'Keep body language instructional and confident, with realistic micro-movement and no abrupt action changes.',
    "Timing lock: deliver the dialogue naturally and finish comfortably within #{clip_seconds} seconds (#{word_count} words).",
    "Dialogue lock: speak this exact script segment once while continuing the same action: \"#{safe_dialogue}\".",
    'Audio lock: clean spoken narration only, no background music, no singing, no lyrics, and no voice imitation of copyrighted audio style.',
    (instruction_text.empty? ? nil : "Execution constraints: #{instruction_text}."),
    'No screens, no digital UI, no overlays, no subtitles, and no on-screen text.'
  ].compact.join(' ')

  sanitize_video_prompt_text(prompt)
end

def build_series_infographic_image_prompt(series_title, concept, style_note, instructions = '')
  instruction_text = squeeze_space(instructions.to_s)
  prompt = [
    "Vertical 9:16 educational infographic key visual for \"#{series_title}\".",
    "Concept focus: #{concept}.",
    "Style: #{style_note}.",
    (instruction_text.empty? ? nil : "Design constraints: #{instruction_text}."),
    'Design with clean iconography, charts, callout shapes, and color-coded information hierarchy.',
    'No people, no logos, no brand marks, and no readable text characters.'
  ].compact.join(' ')

  append_image_guardrails(prompt)
end

def build_series_infographic_video_prompt(series_title, concept, clip_index, total_clips, clip_seconds, instructions = '')
  instruction_text = squeeze_space(instructions.to_s)
  prompt = [
    "#{clip_seconds}-second vertical 9:16 motion infographic segment #{clip_index}/#{total_clips} for \"#{series_title}\".",
    "Animate the provided concept frame with subtle parallax, light camera drift, and smooth emphasis transitions: #{concept}.",
    'Audio lock: no vocals, no music, no singing, no lyrics; keep this as a silent visual animation.',
    (instruction_text.empty? ? nil : "Animation constraints: #{instruction_text}."),
    'Keep motion clean and legible, without adding new elements or new text.',
    'No characters, no narration cues, no subtitles, and no on-screen UI overlays.'
  ].compact.join(' ')

  sanitize_video_prompt_text(prompt)
end

def build_series_host_video_retry_prompt(series_title, script_chunk, clip_index, total_clips, clip_seconds)
  safe_dialogue = sanitize_dialogue_for_prompt(script_chunk)
  prompt = [
    "#{clip_seconds}-second vertical 9:16 talking-head educational segment #{clip_index}/#{total_clips} for \"#{series_title}\".",
    'Use the same presenter identity from the reference image with strict continuity.',
    "Speak this exact dialogue once and only once: \"#{safe_dialogue}\".",
    'Audio lock: plain spoken narration only, no background music, no singing, no lyrics, no jingles, no sound design references.',
    'Delivery lock: neutral natural tone, clear lip sync, same action throughout, finish within clip duration.',
    'No screens, no overlays, no subtitles, and no on-screen text.'
  ].join(' ')

  sanitize_video_prompt_text(prompt)
end

def build_series_infographic_video_retry_prompt(series_title, concept, clip_index, total_clips, clip_seconds)
  prompt = [
    "#{clip_seconds}-second vertical 9:16 infographic animation segment #{clip_index}/#{total_clips} for \"#{series_title}\".",
    "Animate this concept only: #{concept}.",
    'Hard audio lock: absolutely no audio track, no vocals, no music, no lyrics.',
    'No characters, no text overlays, no subtitles, and no UI.'
  ].join(' ')

  sanitize_video_prompt_text(prompt)
end

def series_retryable_video_error?(message)
  lowered = message.to_s.downcase
  return true if lowered.include?('gemini filtered this video attempt')
  return true if lowered.include?('audio') && lowered.include?('could not create your video')
  return true if lowered.include?('timed out waiting for gemini veo generation')

  false
end

def series_audio_filtered_error?(message)
  lowered = message.to_s.downcase
  return false unless lowered.include?('filtered') || lowered.include?('could not create your video')

  lowered.include?('audio')
end

def generate_series_video_with_retries(prompt:, retry_prompt:, aspect_ratio:, clip_duration:, reference_image:, clip_index:, clip_type:, requested_model:)
  attempts = [SERIES_VIDEO_RETRY_ATTEMPTS.to_i, 1].max
  collected_errors = []

  attempts.times do |attempt_index|
    active_prompt = if attempt_index.zero?
                      prompt.to_s
                    elsif retry_prompt.to_s.strip.empty?
                      prompt.to_s
                    else
                      retry_prompt.to_s
                    end

    use_fallback_model = attempt_index == (attempts - 1) &&
                         !SERIES_AUDIO_FILTER_FALLBACK_MODEL.empty? &&
                         !requested_model.to_s.empty? &&
                         requested_model.to_s != SERIES_AUDIO_FILTER_FALLBACK_MODEL

    previous_model = ENV['GEMINI_VEO_MODEL']
    ENV['GEMINI_VEO_MODEL'] = SERIES_AUDIO_FILTER_FALLBACK_MODEL if use_fallback_model

    begin
      return generate_video(active_prompt, aspect_ratio, clip_duration, reference_image)
    rescue StandardError => e
      message = squeeze_space(e.message.to_s)
      collected_errors << message
      retryable = series_retryable_video_error?(message)
      raise "#{clip_type.capitalize} clip #{clip_index} failed: #{message}" unless retryable && attempt_index < (attempts - 1)

      sleep([0.9 * (attempt_index + 1), 3.0].min)
    ensure
      if use_fallback_model
        if previous_model.nil? || previous_model.to_s.strip.empty?
          ENV.delete('GEMINI_VEO_MODEL')
        else
          ENV['GEMINI_VEO_MODEL'] = previous_model
        end
      end
    end
  end

  raise "#{clip_type.capitalize} clip #{clip_index} failed after #{attempts} attempts: #{collected_errors.last}"
end

def resolve_ffprobe_bin
  custom = ENV.fetch('FFPROBE_BIN', '').to_s.strip
  return custom unless custom.empty?

  'ffprobe'
end

def command_exists?(command)
  _stdout, _stderr, status = Open3.capture3('sh', '-lc', "command -v #{command} >/dev/null 2>&1")
  status.success?
rescue StandardError
  false
end

def media_duration_seconds(path)
  ffprobe_bin = resolve_ffprobe_bin
  stdout, _stderr, status = Open3.capture3(
    ffprobe_bin,
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nokey=1:noprint_wrappers=1',
    path.to_s
  )
  return 0.0 unless status.success?

  duration = stdout.to_s.strip.to_f
  duration.positive? ? duration : 0.0
rescue Errno::ENOENT
  0.0
end

def atempo_filter_for_factor(factor)
  value = factor.to_f
  value = 1.0 if value <= 0.0

  filters = []
  while value > 2.0
    filters << 'atempo=2.0'
    value /= 2.0
  end
  while value < 0.5
    filters << 'atempo=0.5'
    value /= 0.5
  end
  filters << format('atempo=%.4f', value)
  filters.join(',')
end

def synthesize_voiceover_with_say(script_text, target_seconds, output_audio_path)
  raise 'Local speech synthesizer (say) is not available.' unless command_exists?('say')

  safe_text = squeeze_space(script_text.to_s)
  raise 'Voiceover text is empty.' if safe_text.empty?

  target = target_seconds.to_f
  target = SERIES_DEFAULT_CLIP_SECONDS.to_f if target <= 0

  base_name = File.basename(output_audio_path.to_s, File.extname(output_audio_path.to_s))
  work_dir = File.dirname(output_audio_path.to_s)
  temp_aiff = File.join(work_dir, "#{base_name}.voiceover.aiff")

  voice = ENV.fetch('SERIES_VOICEOVER_VOICE', '').to_s.strip
  rate = ENV.fetch('SERIES_VOICEOVER_RATE', '165').to_i
  rate = 165 if rate <= 0

  say_command = ['say', '-r', rate.to_s, '-o', temp_aiff]
  say_command += ['-v', voice] unless voice.empty?
  say_command << safe_text

  _say_stdout, say_stderr, say_status = Open3.capture3(*say_command)
  unless say_status.success?
    message = squeeze_space(say_stderr.to_s)
    message = 'Unknown speech synthesis error.' if message.empty?
    raise "Speech synthesis failed: #{message}"
  end

  generated_duration = media_duration_seconds(temp_aiff)
  factor = generated_duration.positive? ? (generated_duration / target) : 1.0
  filter = atempo_filter_for_factor(factor)

  ffmpeg_bin = resolve_ffmpeg_bin
  ffmpeg_command = [
    ffmpeg_bin,
    '-y',
    '-i',
    temp_aiff,
    '-af',
    filter,
    '-t',
    format('%.3f', target),
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    output_audio_path
  ]
  _stdout, stderr, status = Open3.capture3(*ffmpeg_command)
  unless status.success?
    message = squeeze_space(stderr.to_s)
    message = 'Unknown ffmpeg voiceover processing error.' if message.empty?
    raise "Voiceover processing failed: #{message}"
  end

  true
rescue Errno::ENOENT => e
  raise "Voiceover tool not found: #{e.message}"
ensure
  FileUtils.rm_f(temp_aiff) if defined?(temp_aiff) && temp_aiff && File.exist?(temp_aiff)
end

def mux_audio_into_video(video_path, audio_path)
  ffmpeg_bin = resolve_ffmpeg_bin
  temp_output = video_path.to_s.sub(/\.mp4\z/, '.with-audio.mp4')
  temp_output = "#{video_path}.with-audio.mp4" if temp_output == video_path

  command = [
    ffmpeg_bin,
    '-y',
    '-i',
    video_path.to_s,
    '-i',
    audio_path.to_s,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-shortest',
    temp_output
  ]

  _stdout, stderr, status = Open3.capture3(*command)
  unless status.success?
    message = squeeze_space(stderr.to_s)
    message = 'Unknown ffmpeg mux error.' if message.empty?
    raise "Muxing clip audio failed: #{message}"
  end

  FileUtils.mv(temp_output, video_path, force: true)
rescue Errno::ENOENT => e
  raise "Muxing tool not found: #{e.message}"
ensure
  FileUtils.rm_f(temp_output) if defined?(temp_output) && temp_output && File.exist?(temp_output)
end

def build_series_host_silent_video_prompt(series_title, script_chunk, clip_index, total_clips, clip_seconds)
  safe_dialogue = sanitize_dialogue_for_prompt(script_chunk)
  prompt = [
    "#{clip_seconds}-second vertical 9:16 educational host segment #{clip_index}/#{total_clips} for \"#{series_title}\".",
    'Use the same approved presenter identity and wardrobe continuity from the reference image.',
    "Dialogue guidance for lip movement only: \"#{safe_dialogue}\".",
    'Audio lock: output must be fully silent with no generated audio track.',
    'Host looks into camera with natural explanatory mouth movement, while keeping one consistent seated action.',
    'No screens, no overlays, no subtitles, and no on-screen text.'
  ].join(' ')

  sanitize_video_prompt_text(prompt)
end

def render_host_clip_with_voiceover_fallback(
  series_title:,
  script_chunk:,
  clip_index:,
  total_clips:,
  clip_duration:,
  aspect_ratio:,
  reference_image:,
  clip_path:
)
  silent_prompt = build_series_host_silent_video_prompt(
    series_title,
    script_chunk,
    clip_index,
    total_clips,
    clip_duration
  )
  silent_result = generate_video(silent_prompt, aspect_ratio, clip_duration, reference_image)
  silent_bytes = extract_video_bytes(silent_result)
  File.binwrite(clip_path, silent_bytes)

  voiceover_path = clip_path.to_s.sub(/\.mp4\z/, '.voiceover.m4a')
  synthesize_voiceover_with_say(script_chunk, clip_duration, voiceover_path)
  mux_audio_into_video(clip_path, voiceover_path)
  FileUtils.rm_f(voiceover_path)

  {
    used_voiceover_fallback: true,
    video_prompt: silent_prompt
  }
end

def parse_reference_image_entry(entry)
  if entry.is_a?(String)
    raw = entry.to_s.strip
    return nil if raw.empty?

    mime_type = 'image/png'
    data_url_match = raw.match(%r{\Adata:([^;]+);base64,(.+)\z}m)
    if data_url_match
      mime_type = data_url_match[1].to_s.strip
      raw = data_url_match[2].to_s
    end

    return {
      base64: raw.gsub(/\s+/, ''),
      mime_type: mime_type.empty? ? 'image/png' : mime_type
    }
  end

  return nil unless entry.is_a?(Hash)

  base64_candidate = first_present_value(
    entry,
    [
      ['base64'],
      ['image_base64'],
      ['reference_image_base64'],
      ['referenceImageBase64'],
      ['bytesBase64Encoded'],
      ['image', 'base64']
    ]
  )
  return nil unless base64_candidate.is_a?(String)

  base64_value = base64_candidate.strip
  return nil if base64_value.empty?

  mime_candidate = first_present_value(
    entry,
    [
      ['mime_type'],
      ['mimeType'],
      ['image_mime_type'],
      ['reference_image_mime_type'],
      ['referenceImageMimeType'],
      ['imageMimeType']
    ]
  )
  mime_type = mime_candidate.is_a?(String) && !mime_candidate.strip.empty? ? mime_candidate.strip : 'image/png'

  data_url_match = base64_value.match(%r{\Adata:([^;]+);base64,(.+)\z}m)
  if data_url_match
    mime_type = data_url_match[1].to_s.strip if mime_candidate.to_s.strip.empty?
    base64_value = data_url_match[2].to_s
  end

  {
    base64: base64_value.gsub(/\s+/, ''),
    mime_type: mime_type.empty? ? 'image/png' : mime_type
  }
end

def extract_reference_images_from_body(body)
  return [] unless body.is_a?(Hash)

  images = []
  primary = extract_reference_image_from_body(body)
  images << primary if primary.is_a?(Hash)

  array_candidate = first_present_value(
    body,
    [
      ['reference_images'],
      ['referenceImages'],
      ['host_images'],
      ['hostImages'],
      ['hostAngles'],
      ['host_angles'],
      ['cameraAngles'],
      ['camera_angles']
    ]
  )

  if array_candidate.is_a?(Array)
    array_candidate.each do |entry|
      parsed = parse_reference_image_entry(entry)
      images << parsed if parsed.is_a?(Hash)
    end
  end

  deduped = []
  seen = {}
  images.each do |image|
    key = "#{image[:mime_type]}:#{image[:base64]}"
    next if seen[key]

    seen[key] = true
    deduped << image
  end

  deduped
end

def mime_type_from_path(file_path)
  ext = File.extname(file_path.to_s).downcase
  return 'image/jpeg' if ext == '.jpg' || ext == '.jpeg'
  return 'image/webp' if ext == '.webp'

  'image/png'
end

def load_default_host_reference_images
  paths = []
  configured_paths = ENV.fetch('DEFAULT_HOST_IMAGE_PATHS', '').to_s.strip
  unless configured_paths.empty?
    configured_paths.split(',').map(&:strip).reject(&:empty?).each do |candidate|
      absolute = candidate.start_with?('/') ? candidate : File.join(ROOT_DIR, candidate)
      paths << absolute if File.file?(absolute)
    end
  end

  if paths.empty?
    Dir.glob(DEFAULT_SERIES_HOST_IMAGE_GLOB).sort.each do |candidate|
      next unless File.file?(candidate)
      next unless candidate.downcase.match?(/\.(png|jpg|jpeg|webp)\z/)

      paths << candidate
    end
  end

  images = []
  paths.each do |file_path|
    bytes = File.binread(file_path)
    next if bytes.nil? || bytes.empty?

    images << {
      base64: Base64.strict_encode64(bytes),
      mime_type: mime_type_from_path(file_path)
    }
  rescue StandardError
    next
  end

  images
end

def decode_base64_bytes(value, label)
  raw = value.to_s.gsub(/\s+/, '').strip
  raise "#{label} is empty." if raw.empty?

  Base64.strict_decode64(raw)
rescue ArgumentError => e
  raise "#{label} is not valid base64: #{e.message}"
end

def normalize_image_result_as_reference(image_result, label)
  base64_value = image_result[:image_base64].to_s.strip
  mime_type = image_result[:mime_type].to_s.strip
  raise "#{label} did not include image_base64 bytes." if base64_value.empty?

  {
    base64: base64_value,
    mime_type: mime_type.empty? ? 'image/png' : mime_type
  }
end

def download_video_bytes(url)
  response = http_request(
    method: 'GET',
    url: url,
    token: '',
    timeout_sec: 180,
    auth_header: 'Authorization',
    auth_prefix: 'Bearer',
    json_body: nil,
    follow_redirects: true,
    max_redirects: 5
  )

  if response[:kind] == :binary_video && response[:ok]
    return response[:body]
  end

  if !response[:ok]
    details = extract_error_message(response[:data])
    details = response[:raw_text].to_s if details.empty?
    raise "Video download failed (HTTP #{response[:status_code]}): #{details}"
  end

  raise 'Video download did not return binary content.'
end

def extract_video_bytes(result)
  if result[:binary]
    body = result[:body]
    raise 'Video response body was empty.' unless body.is_a?(String) && !body.empty?

    return body
  end

  video_base64 = result[:video_base64].to_s.strip
  return decode_base64_bytes(video_base64, 'Generated video base64') unless video_base64.empty?

  video_url = result[:video_url].to_s.strip
  return download_video_bytes(video_url) unless video_url.empty?

  raise 'Video generation response had no binary, base64, or video URL payload.'
end

def merge_series_clips(clip_paths, output_path)
  raise 'No clips were provided for merge.' if !clip_paths.is_a?(Array) || clip_paths.empty?

  ffmpeg_bin = resolve_ffmpeg_bin
  work_dir = File.dirname(output_path)
  concat_list_path = File.join(work_dir, 'clips.concat.txt')
  concat_payload = clip_paths.map { |clip_path| "file '#{clip_path.gsub("'", %q('\\''))}'" }.join("\n")
  File.write(concat_list_path, concat_payload)

  command = [
    ffmpeg_bin,
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concat_list_path,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    output_path
  ]

  _stdout, stderr, status = Open3.capture3(*command)
  unless status.success?
    message = stderr.to_s.strip
    message = 'Unknown ffmpeg error.' if message.empty?
    raise "FFmpeg stitch failed: #{message}"
  end
rescue Errno::ENOENT
  raise "FFmpeg not found at #{ffmpeg_bin}. Install ffmpeg or set FFMPEG_BIN."
end

def generate_educational_series(payload)
  series_title = squeeze_space(
    first_present_value(
      payload,
      [
        ['seriesTitle'],
        ['episodeTitle'],
        ['title']
      ]
    ).to_s
  )
  series_title = 'MFD Shaala' if series_title.empty?

  script = normalize_script_text(
    first_present_value(
      payload,
      [
        ['lockedScript'],
        ['script'],
        ['episodeScript']
      ]
    ).to_s
  )
  raise ArgumentError, 'lockedScript is required.' if script.empty?
  raise ArgumentError, 'Provide a longer educational script (minimum 24 words).' if script.split(' ').length < 24

  requested_target_duration = first_present_value(
    payload,
    [['targetDurationSeconds'], ['durationSeconds'], ['target_duration_seconds']]
  )
  clip_duration = clamp_integer(
    first_present_value(payload, [['clipDurationSeconds'], ['clipSeconds'], ['clip_duration_seconds']]),
    6,
    10,
    SERIES_DEFAULT_CLIP_SECONDS
  )
  include_infographics = parse_boolean(
    first_present_value(payload, [['includeInfographics'], ['include_infographics']]),
    true
  )
  aspect_ratio = squeeze_space(
    first_present_value(payload, [['aspectRatio'], ['aspect_ratio']]).to_s
  )
  aspect_ratio = '9:16' if aspect_ratio.empty?

  infographic_style = squeeze_space(
    first_present_value(payload, [['infographicStyle'], ['infographic_style'], ['visualStyle']]).to_s
  )
  infographic_style =
    'Nano Banana Pro educational finance style, clean icon-led composition, high contrast, modern gradients' if infographic_style.empty?
  series_instructions = squeeze_space(
    first_present_value(
      payload,
      [
        ['seriesInstructions'],
        ['specificInstructions'],
        ['instructions'],
        ['guidelines'],
        ['brandGuidelines']
      ]
    ).to_s
  )
  requested_veo_model = squeeze_space(
    first_present_value(payload, [['veoModel'], ['videoModel'], ['veo_model'], ['model']]).to_s
  )
  requested_veo_model = 'veo-3.0-generate-001' if requested_veo_model.empty?
  max_words_per_host_clip = clamp_integer(
    first_present_value(payload, [['maxWordsPerHostClip'], ['max_words_per_host_clip']]),
    12,
    24,
    SERIES_MAX_WORDS_PER_HOST_CLIP
  )
  shuffle_host_angles = parse_boolean(
    first_present_value(payload, [['shuffleHostAngles'], ['shuffle_host_angles']]),
    true
  )

  target_duration_estimated = requested_target_duration.nil? || requested_target_duration.to_s.strip.empty?
  target_duration = if target_duration_estimated
                      estimate_series_target_duration_seconds(
                        script,
                        clip_duration,
                        include_infographics,
                        max_words_per_host_clip
                      )
                    else
                      clamp_integer(
                        requested_target_duration,
                        SERIES_MIN_TARGET_SECONDS,
                        SERIES_MAX_TARGET_SECONDS,
                        SERIES_DEFAULT_TARGET_SECONDS
                      )
                    end

  total_clips = (target_duration.to_f / clip_duration).round
  total_clips = [[total_clips, 1].max, 12].min
  total_clips = [total_clips, 3].max if include_infographics

  required_host_chunks = split_script_into_safe_host_chunks(script, max_words_per_host_clip)
  if required_host_chunks.length > total_clips
    required_seconds = required_host_chunks.length * clip_duration
    raise ArgumentError,
          "Script is too long for #{target_duration}s with #{clip_duration}s clips. Need at least #{required_seconds}s (#{required_host_chunks.length} host clips at <=#{max_words_per_host_clip} words each)."
  end

  reference_images = extract_reference_images_from_body(payload)
  if reference_images.empty?
    reference_images = load_default_host_reference_images
  end
  if reference_images.empty?
    character_prompt = squeeze_space(
      first_present_value(
        payload,
        [
          ['characterPrompt'],
          ['characterImagePrompt'],
          ['character_prompt']
        ]
      ).to_s
    )
    character_prompt = DEFAULT_SERIES_HOST_PROMPT if character_prompt.empty?

    generated_image = generate_character_image(character_prompt, aspect_ratio)
    reference_images << normalize_image_result_as_reference(generated_image, 'Character image generation')
  end

  series_id = "#{Time.now.utc.strftime('%Y%m%d-%H%M%S')}-#{SecureRandom.hex(4)}"
  series_dir = File.join(SERIES_PUBLIC_DIR, series_id)
  FileUtils.mkdir_p(series_dir)

  begin
    previous_veo_model = ENV['GEMINI_VEO_MODEL']
    ENV['GEMINI_VEO_MODEL'] = requested_veo_model

    begin
      host_reference_images = reference_images.dup
      if shuffle_host_angles && host_reference_images.length > 1
        host_reference_images = host_reference_images.shuffle(random: Random.new)
      end

      host_reference_manifest = []
      host_reference_images.each_with_index do |reference_image, index|
        image_bytes = decode_base64_bytes(reference_image[:base64], "reference_image_base64[#{index}]")
        image_ext = reference_image[:mime_type].to_s.downcase.include?('jpeg') ? 'jpg' : 'png'
        image_file = format('host-reference-%02d.%s', index + 1, image_ext)
        File.binwrite(File.join(series_dir, image_file), image_bytes)
        host_reference_manifest << {
          'index' => index + 1,
          'file' => image_file,
          'url' => "/generated-series/#{series_id}/#{image_file}",
          'mimeType' => reference_image[:mime_type].to_s.strip.empty? ? 'image/png' : reference_image[:mime_type].to_s.strip
        }
      end

      plan = build_series_clip_plan(script, total_clips, include_infographics, max_words_per_host_clip)
      raise 'Unable to build clip plan from script.' if plan.empty?

      rendered_clips = []
      clip_paths = []
      host_clip_counter = 0

      plan.each do |clip|
        clip_index = clip['index'].to_i
        clip_type = clip['type'].to_s

        if clip_type == 'host'
          script_chunk = clip['scriptChunk'].to_s
          script_word_count = script_chunk.split(' ').length
          if script_word_count > max_words_per_host_clip
            raise "Host clip #{clip_index} has #{script_word_count} words, exceeding limit #{max_words_per_host_clip} for #{clip_duration}s delivery."
          end

          reference_index = host_clip_counter % host_reference_images.length
          reference_image = host_reference_images[reference_index]
          reference_info = host_reference_manifest[reference_index]
          host_clip_counter += 1

          host_prompt = build_series_host_video_prompt(
            series_title,
            clip['scriptChunk'],
            clip_index,
            plan.length,
            clip_duration,
            series_instructions
          )
          host_retry_prompt = build_series_host_video_retry_prompt(
            series_title,
            clip['scriptChunk'],
            clip_index,
            plan.length,
            clip_duration
          )
          clip_file = format('clip-%02d-host.mp4', clip_index)
          clip_path = File.join(series_dir, clip_file)
          host_prompt_used = host_prompt
          host_voiceover_fallback = false

          begin
            host_result = generate_series_video_with_retries(
              prompt: host_prompt,
              retry_prompt: host_retry_prompt,
              aspect_ratio: aspect_ratio,
              clip_duration: clip_duration,
              reference_image: reference_image,
              clip_index: clip_index,
              clip_type: 'host',
              requested_model: requested_veo_model
            )
            host_bytes = extract_video_bytes(host_result)
            File.binwrite(clip_path, host_bytes)
          rescue StandardError => e
            message = e.message.to_s
            raise unless series_audio_filtered_error?(message)

            fallback_render = render_host_clip_with_voiceover_fallback(
              series_title: series_title,
              script_chunk: clip['scriptChunk'],
              clip_index: clip_index,
              total_clips: plan.length,
              clip_duration: clip_duration,
              aspect_ratio: aspect_ratio,
              reference_image: reference_image,
              clip_path: clip_path
            )
            host_prompt_used = fallback_render[:video_prompt].to_s
            host_voiceover_fallback = fallback_render[:used_voiceover_fallback] == true
          end

          clip_paths << clip_path
          rendered_clips << clip.merge(
            'scriptWordCount' => script_word_count,
            'hostAngleRef' => reference_info['index'],
            'hostAngleImageUrl' => reference_info['url'],
            'videoPrompt' => host_prompt_used,
            'voiceoverFallback' => host_voiceover_fallback,
            'videoFile' => clip_file,
            'videoUrl' => "/generated-series/#{series_id}/#{clip_file}"
          )
          next
        end

        concept = clip['concept'].to_s
        image_prompt = build_series_infographic_image_prompt(series_title, concept, infographic_style, series_instructions)
        infographic_image_result = generate_character_image(image_prompt, aspect_ratio)
        infographic_reference = normalize_image_result_as_reference(infographic_image_result, "Infographic image for clip #{clip_index}")
        infographic_image_bytes = decode_base64_bytes(
          infographic_reference[:base64],
          "Infographic image base64 for clip #{clip_index}"
        )
        infographic_image_ext = infographic_reference[:mime_type].to_s.downcase.include?('jpeg') ? 'jpg' : 'png'
        infographic_image_file = format('clip-%02d-infographic.%s', clip_index, infographic_image_ext)
        File.binwrite(File.join(series_dir, infographic_image_file), infographic_image_bytes)

        infographic_video_prompt = build_series_infographic_video_prompt(
          series_title,
          concept,
          clip_index,
          plan.length,
          clip_duration,
          series_instructions
        )
        infographic_retry_prompt = build_series_infographic_video_retry_prompt(
          series_title,
          concept,
          clip_index,
          plan.length,
          clip_duration
        )
        infographic_video_result = generate_series_video_with_retries(
          prompt: infographic_video_prompt,
          retry_prompt: infographic_retry_prompt,
          aspect_ratio: aspect_ratio,
          clip_duration: clip_duration,
          reference_image: infographic_reference,
          clip_index: clip_index,
          clip_type: 'infographic',
          requested_model: requested_veo_model
        )
        infographic_video_bytes = extract_video_bytes(infographic_video_result)

        clip_file = format('clip-%02d-infographic.mp4', clip_index)
        clip_path = File.join(series_dir, clip_file)
        File.binwrite(clip_path, infographic_video_bytes)

        clip_paths << clip_path
        rendered_clips << clip.merge(
          'imagePrompt' => image_prompt,
          'imageFile' => infographic_image_file,
          'imageUrl' => "/generated-series/#{series_id}/#{infographic_image_file}",
          'videoPrompt' => infographic_video_prompt,
          'videoFile' => clip_file,
          'videoUrl' => "/generated-series/#{series_id}/#{clip_file}"
        )
      end

      final_file = 'final.mp4'
      final_path = File.join(series_dir, final_file)
      merge_series_clips(clip_paths, final_path)

      created_at = Time.now.utc.strftime('%Y-%m-%dT%H:%M:%SZ')
      plan_payload = {
        seriesId: series_id,
        createdAt: created_at,
        seriesTitle: series_title,
        aspectRatio: aspect_ratio,
        veoModel: requested_veo_model,
        shuffleHostAngles: shuffle_host_angles,
        hostAngleCount: host_reference_manifest.length,
        hostReferenceImages: host_reference_manifest,
        maxWordsPerHostClip: max_words_per_host_clip,
        seriesInstructions: series_instructions,
        clipDurationSeconds: clip_duration,
        targetDurationSeconds: target_duration,
        targetDurationEstimated: target_duration_estimated,
        includeInfographics: include_infographics,
        totalClips: rendered_clips.length,
        estimatedDurationSeconds: rendered_clips.length * clip_duration,
        scriptWordCount: script.split(' ').length,
        sourceScript: script,
        clips: rendered_clips
      }
      File.write(File.join(series_dir, 'series-plan.json'), JSON.pretty_generate(plan_payload))

      {
        status: 'completed',
        series_id: series_id,
        final_video_url: "/generated-series/#{series_id}/#{final_file}",
        plan_url: "/generated-series/#{series_id}/series-plan.json",
        character_image_url: host_reference_manifest[0]['url'],
        host_angle_count: host_reference_manifest.length,
        max_words_per_host_clip: max_words_per_host_clip,
        series_instructions: series_instructions,
        clip_count: rendered_clips.length,
        aspect_ratio: aspect_ratio,
        veo_model: requested_veo_model,
        clip_duration_seconds: clip_duration,
        target_duration_seconds: target_duration,
        target_duration_estimated: target_duration_estimated
      }
    ensure
      if previous_veo_model.nil? || previous_veo_model.strip.empty?
        ENV.delete('GEMINI_VEO_MODEL')
      else
        ENV['GEMINI_VEO_MODEL'] = previous_veo_model
      end
    end
  rescue StandardError
    FileUtils.rm_rf(series_dir) if Dir.exist?(series_dir)
    raise
  end
end

def image_guardrail_screen_pattern
  /\b(phone|smartphone|mobile|laptop|tablet|screen|monitor|display|ui|user interface|app interface|notification|overlay|supers?|caption|subtitle)\b/i
end

def remove_screen_sentences(text)
  raw = text.to_s.strip
  return '' if raw.empty?

  parts = raw.split(/(?<=[.!?])\s+/)
  filtered = parts.reject { |sentence| sentence.match?(image_guardrail_screen_pattern) }
  filtered.join(' ').strip
end

def remove_screen_terms(text)
  text.to_s.gsub(image_guardrail_screen_pattern, '').gsub(/\s+/, ' ').strip
end

def append_image_guardrails(prompt_text)
  guardrails = 'Hard image guardrails: subject is not holding or using a phone, laptop, tablet, monitor, or any digital screen. No visible screen UI, app interface, notifications, overlays, supers, subtitles, captions, or text.'
  [prompt_text.to_s.strip, guardrails].reject(&:empty?).join(' ')
end

def extract_gemini_text(data)
  return '' unless data.is_a?(Hash)

  candidates = data['candidates']
  return '' unless candidates.is_a?(Array)

  candidates.each do |candidate|
    parts = nested_get(candidate, ['content', 'parts'])
    next unless parts.is_a?(Array)

    text = parts.map { |part| part.is_a?(Hash) ? part['text'].to_s : '' }.join("\n").strip
    return text unless text.empty?
  end

  ''
end

def parse_json_object_from_text(text)
  source = text.to_s.strip
  return {} if source.empty?

  cleaned = source.gsub(/\A```(?:json)?\s*/i, '').gsub(/\s*```\z/, '').strip
  begin
    parsed = JSON.parse(cleaned)
    return parsed if parsed.is_a?(Hash)
  rescue JSON::ParserError
    # continue with object extraction fallback
  end

  start_index = cleaned.index('{')
  end_index = cleaned.rindex('}')
  return {} if start_index.nil? || end_index.nil? || end_index <= start_index

  candidate = cleaned[start_index..end_index]
  parsed = JSON.parse(candidate)
  parsed.is_a?(Hash) ? parsed : {}
rescue JSON::ParserError
  {}
end

def squeeze_space(text)
  text.to_s.gsub(/\s+/, ' ').strip
end

def append_video_guardrails(prompt_text)
  base = squeeze_space(prompt_text.to_s)
  guardrails = 'Video guardrails: no digital-device interaction and no visible digital interface elements. No overlays, supers, subtitles, captions, or on-screen text.'
  return base if base.downcase.include?('video guardrails:')

  [base, guardrails].reject(&:empty?).join(' ')
end

def has_indian_context?(text)
  text.to_s.match?(/\bindian\b/i) || text.to_s.match?(/\bindia\b/i)
end

def append_indian_context(text, suffix)
  base = squeeze_space(text.to_s)
  return squeeze_space(suffix.to_s) if base.empty?
  return base if has_indian_context?(base)

  [base, suffix.to_s].reject(&:empty?).join(' ').strip
end

def enforce_indian_character_context_in_logic!(parsed)
  return unless parsed.is_a?(Hash)

  parsed['personaContext'] = append_indian_context(
    parsed['personaContext'],
    'Nationality and cultural context: Indian, based in India.'
  )
  parsed['backstory'] = append_indian_context(
    parsed['backstory'],
    'This character is Indian and currently based in India.'
  )
  parsed['settingProfile'] = append_indian_context(
    parsed['settingProfile'],
    'Location lock: India-based lived-in environment.'
  )
  parsed['characterImagePrompt'] = append_indian_context(
    parsed['characterImagePrompt'],
    'Identity lock: Indian subject, India-based lifestyle setting, authentic Indian facial and skin-tone realism.'
  )
end

def sanitize_video_prompt_text(text)
  raw = squeeze_space(text.to_s)
  return '' if raw.empty?

  without_guardrails = raw.gsub(/video guardrails:.*\z/i, '').strip
  sanitized = remove_screen_sentences(without_guardrails)
  sanitized = remove_screen_terms(without_guardrails) if sanitized.empty?
  append_video_guardrails(squeeze_space(sanitized))
end

def rebuild_video_final_prompt(parsed, locked_script)
  activity_raw = parsed['primaryActivity'].to_s
  activity = remove_screen_sentences(activity_raw)
  activity = remove_screen_terms(activity_raw) if activity.empty?
  activity = 'character performs one continuous real-world activity' if activity.empty?

  setting_raw = parsed['settingProfile'].to_s
  setting = remove_screen_sentences(setting_raw)
  setting = remove_screen_terms(setting_raw) if setting.empty?

  slice_raw = parsed['sliceOfLifeDirection'].to_s
  slice = remove_screen_sentences(slice_raw)
  slice = remove_screen_terms(slice_raw) if slice.empty?

  funnel = squeeze_space(remove_screen_sentences(parsed['funnelMandate'].to_s))
  voice = distilled_voice_directive(parsed['voiceProfile'].to_s)
  script = locked_script.to_s.strip

  segments = []
  segments << '8-second vertical 9:16 slice-of-life video with one continuous action.'
  segments << "Activity lock: #{activity}."
  segments << "Scene lock: #{setting}." unless setting.empty?
  segments << "Beat direction: #{slice}." unless slice.empty?
  segments << "Funnel intent: #{funnel}." unless funnel.empty?
  segments << "Voice direction: #{voice}"
  segments << "Dialogue lock: speak the exact script once, naturally while continuing the same activity: \"#{script}\"." unless script.empty?

  sanitize_video_prompt_text(segments.join(' '))
end

def enforce_video_no_screen_in_logic!(parsed)
  return unless parsed.is_a?(Hash)

  %w[primaryActivity settingProfile sliceOfLifeDirection distilledSpec].each do |key|
    next unless parsed[key].is_a?(String)

    sanitized = remove_screen_sentences(parsed[key])
    sanitized = remove_screen_terms(parsed[key]) if sanitized.empty?
    parsed[key] = squeeze_space(sanitized)
  end

  parsed['finalPrompt'] = sanitize_video_prompt_text(parsed['finalPrompt'].to_s)
end

def truncate_words(text, max_words)
  words = squeeze_space(text).split(' ')
  return words.join(' ') if max_words <= 0 || words.length <= max_words

  "#{words.first(max_words).join(' ')}..."
end

def final_prompt_has_voice_directive?(prompt_text)
  prompt = prompt_text.to_s
  return false if prompt.strip.empty?

  cues = [
    /\bpitch\b/i,
    /\btimbre\b/i,
    /\bresonance\b/i,
    /\bcadence\b/i,
    /\baccent\b/i,
    /\bdialect\b/i,
    /\bbreathiness\b/i,
    /\bintonation\b/i,
    /\b(?:\d{2,3}\s*-\s*\d{2,3}\s*hz|\d{2,3}\s*hz)\b/i
  ]
  matched = cues.count { |pattern| prompt.match?(pattern) }
  matched >= 3
end

def distilled_voice_directive(voice_profile)
  text = squeeze_space(voice_profile)
  return 'natural Indian-English voice, grounded cadence, controlled pauses, and clear articulation.' if text.empty?

  compact = truncate_words(text, 55)
  compact.end_with?('.', '!', '?') ? compact : "#{compact}."
end

def ensure_voice_in_final_prompt!(parsed)
  return unless parsed.is_a?(Hash)

  final_prompt = parsed['finalPrompt'].to_s.strip
  voice_profile = parsed['voiceProfile'].to_s.strip
  return if final_prompt.empty? || voice_profile.empty?
  return if final_prompt_has_voice_directive?(final_prompt)

  parsed['finalPrompt'] = "#{final_prompt} Voice direction: #{distilled_voice_directive(voice_profile)}"
end

def normalize_logic_result_for_response(result)
  payload = {}
  %w[
    resolvedAspectRatio
    personaContext
    backstory
    visualProfile
    voiceProfile
    wardrobeProfile
    characterImagePrompt
    primaryActivity
    settingProfile
    sliceOfLifeDirection
    funnelMandate
    verticalMandate
    distilledSpec
    directionSnapshot
    finalPrompt
  ].each do |key|
    value = result[key]
    payload[key] = value if value.is_a?(String) && !value.strip.empty?
  end
  payload
end

def generate_logic_with_gemini(inputs)
  api_key = ENV.fetch('GEMINI_API_KEY', '').strip
  raise 'GEMINI_API_KEY is not set. Add it in your .env file.' if api_key.empty?

  base_url = ENV.fetch('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta').strip.sub(%r{/$}, '')
  model = ENV.fetch('GEMINI_LOGIC_MODEL', 'gemini-3.1-pro-preview').strip
  timeout_sec = ENV.fetch('LOGIC_TIMEOUT_SEC', '90').to_i
  timeout_sec = 90 if timeout_sec <= 0

  instructions = <<~PROMPT
    You are a Senior Casting Director and a Professional Cinematographer.
    Goal: Create a "Real Person" character profile that looks like a high-end film still or a raw documentary photograph.
    Country context is always India.
    Return only JSON (no markdown) with these exact string keys:
    resolvedAspectRatio, personaContext, backstory, visualProfile, voiceProfile, wardrobeProfile, characterImagePrompt, primaryActivity, settingProfile, sliceOfLifeDirection, funnelMandate, verticalMandate, distilledSpec, directionSnapshot, finalPrompt.

    Field requirements:
    - personaContext: "The Human Profile" with Identity (name, exact age, Indian city, and daily grind/job) and "The Why" (deep motivation for using the brand).
    - personaContext must explicitly include the word "Indian".
    - backstory: 3-4 sentence narrative expanding identity, recent real-world friction, and why this brand matters now, and it must explicitly state the character is Indian and based in India.
    - visualProfile: "Non-Generic Visual Directive" with exactly two asymmetries/imperfections, high-macro skin detail (visible pores, fine lines, slight hyperpigmentation, natural oil sheen), and explicit avoidance of perfect skin and harsh blemishes/scars.
    - wardrobeProfile: include specific garment choices plus clothing weave/texture details (for example linen slub, cotton twill, handloom khadi) and natural creasing.
    - settingProfile: "Cinematic Technical Prompt (Optimized for Imagen)" including:
      composition (camera lens and shot type),
      lived-in lighting only (no studio lights),
      film quality keywords: "Shot on 35mm film", "Raw, unedited photography", "Natural skin tones", "Fine grain", "Subtle motion blur",
      and one realistic lifestyle scene with at least one secondary element connected to the product category.
    - voiceProfile: include all of:
      Vocal Profile (pitch with approximate frequency range in Hz, timbre texture, resonance chest/head mix),
      Speech Patterns (cadence, rhythm, pauses, verbal tics/pronunciations),
      Accent & Dialect (Indian regional influence, social-class markers, accent intensity),
      Emotional Baseline (resting tone and shifts under high-stress vs intimate moments),
      Technical Sliders (0-100%) for Stability, Clarity, Style Exaggeration, Breathiness.
    - primaryActivity: one single continuous action for the full 8 seconds, directly tied to the product category; no task switching and no phone/laptop/tablet/screen usage.
    - funnelMandate: adapt by stage; BoFu must include urgency and a time-sensitive cue.
    - verticalMandate: enforce 9:16 smartphone-native framing.
    - characterImagePrompt: concise Imagen-ready still prompt reflecting the same character and cinematic realism, explicitly grounded in backstory with at least one daily-grind cue, one motivation cue, and one lifestyle-setting cue. It must include concrete scene depth: foreground subject details, mid-ground lifestyle props, and at least one softly blurred secondary background element. It must explicitly include "Indian subject" and an India-based location cue. Do not include phones/laptops/tablets or any visible screen UI/supers/text.
    - distilledSpec: compact summary of all creative decisions.
    - finalPrompt: concise Veo prompt for image-to-video; same character, same single activity, exact locked script spoken once, and explicit voice direction distilled from voiceProfile (pitch, timbre, resonance, cadence/pauses, accent-dialect). Must explicitly keep the scene free of phone/laptop/tablet usage and free of UI/supers/on-screen text.

    Global constraints:
    - Slice-of-life realism, not static talking head.
    - Tone must be gritty, authentic, and grounded; never marketing-perfect.
    - Image still must avoid digital devices and on-screen UI/supers/captions.
    - Video scene must avoid digital device usage (phone/laptop/tablet/monitor) and all UI overlays/supers/captions/on-screen text.
    - Avoid socioeconomic, gender, caste, religion, or class assumptions unless explicitly provided in input.
    - Do not invent income brackets, affluence labels, or luxury-preference claims unless the brand input explicitly states them.
    - Keep persona language neutral and evidence-based, tied to provided audience details and stated pain points.
    - If identity details (name, age, city, profession, lifestyle) are missing, estimate them only from targetAudience, brandGuidelines, and lockedScript; do not use fixed archetype defaults.
    - Infer pain point and desired outcome directly from lockedScript semantics when not explicitly provided.
    - Preserve exact script verbatim in finalPrompt.
    - Never assign non-Indian nationality or non-India residency for the character.
  PROMPT

  input_payload = {
    brandProduct: inputs['brandProduct'].to_s,
    brandGuidelines: inputs['brandGuidelines'].to_s,
    targetAudience: inputs['targetAudience'].to_s,
    funnelStage: inputs['funnelStage'].to_s,
    lockedScript: inputs['lockedScript'].to_s,
    aspectRatio: '9:16',
    country: 'India'
  }

  payload = {
    'contents' => [
      {
        'parts' => [
          { 'text' => instructions },
          { 'text' => "INPUT_JSON:\n#{JSON.generate(input_payload)}" }
        ]
      }
    ],
    'generationConfig' => {
      'responseMimeType' => 'application/json',
      'temperature' => 0.6
    }
  }

  endpoint = "#{base_url}/models/#{model}:generateContent"
  response = http_request(
    method: 'POST',
    url: endpoint,
    token: api_key,
    timeout_sec: timeout_sec,
    auth_header: 'x-goog-api-key',
    auth_prefix: '',
    json_body: payload
  )

  unless response[:ok]
    extracted_error = extract_error_message(response[:data])
    error_text = extracted_error.empty? ? response[:raw_text].to_s : extracted_error
    raise "Gemini logic request failed (HTTP #{response[:status_code]}): #{error_text}"
  end

  data = response[:data]
  raise 'Gemini logic response was not JSON.' unless data.is_a?(Hash)

  text = extract_gemini_text(data)
  parsed = parse_json_object_from_text(text)
  raise 'Gemini logic response did not return valid JSON object.' unless parsed.is_a?(Hash) && !parsed.empty?

  required = %w[
    personaContext
    backstory
    visualProfile
    voiceProfile
    wardrobeProfile
    characterImagePrompt
    primaryActivity
    settingProfile
    sliceOfLifeDirection
    funnelMandate
    verticalMandate
    distilledSpec
    directionSnapshot
    finalPrompt
  ]
  missing = required.select { |key| parsed[key].to_s.strip.empty? }
  raise "Gemini logic missing fields: #{missing.join(', ')}" unless missing.empty?

  enforce_indian_character_context_in_logic!(parsed)
  enforce_video_no_screen_in_logic!(parsed)
  parsed['finalPrompt'] = rebuild_video_final_prompt(parsed, inputs['lockedScript'])
  ensure_voice_in_final_prompt!(parsed)
  parsed['finalPrompt'] = sanitize_video_prompt_text(parsed['finalPrompt'].to_s)
  parsed['resolvedAspectRatio'] = '9:16'
  parsed
end

def extract_reference_image_from_body(body)
  return nil unless body.is_a?(Hash)

  base64_candidate = first_present_value(
    body,
    [
      ['reference_image_base64'],
      ['referenceImageBase64'],
      ['reference_image', 'base64'],
      ['referenceImage', 'base64'],
      ['reference_image', 'bytesBase64Encoded'],
      ['referenceImage', 'bytesBase64Encoded'],
      ['image_base64'],
      ['imageBase64']
    ]
  )
  return nil unless base64_candidate.is_a?(String)

  base64_value = base64_candidate.strip
  return nil if base64_value.empty?

  explicit_mime = first_present_value(
    body,
    [
      ['reference_image_mime_type'],
      ['referenceImageMimeType'],
      ['reference_image', 'mime_type'],
      ['referenceImage', 'mime_type'],
      ['reference_image', 'mimeType'],
      ['referenceImage', 'mimeType'],
      ['image_mime_type'],
      ['imageMimeType'],
      ['mime_type'],
      ['mimeType']
    ]
  )

  mime_value = explicit_mime.is_a?(String) && !explicit_mime.strip.empty? ? explicit_mime.strip : 'image/png'

  data_url_match = base64_value.match(%r{\Adata:([^;]+);base64,(.+)\z}m)
  if data_url_match
    mime_value = data_url_match[1].to_s unless explicit_mime.is_a?(String) && !explicit_mime.strip.empty?
    base64_value = data_url_match[2].to_s
  end

  return nil if base64_value.strip.empty?

  {
    base64: base64_value.strip,
    mime_type: mime_value
  }
end

def extract_gemini_operation_name(data)
  return '' unless data.is_a?(Hash)

  name = first_present_value(
    data,
    [
      ['name'],
      ['operation', 'name'],
      ['operation']
    ]
  )
  name.to_s.strip
end

def extract_gemini_video_uri(data)
  return '' unless data.is_a?(Hash)

  candidate = first_present_value(
    data,
    [
      ['response', 'generateVideoResponse', 'generatedSamples', 0, 'video', 'uri'],
      ['response', 'generateVideoResponse', 'generatedSamples', 0, 'video', 'videoUri'],
      ['response', 'generateVideoResponse', 'generatedSamples', 0, 'video', 'video_url'],
      ['response', 'generateVideoResponse', 'generatedSamples', 0, 'video', 'downloadUri'],
      ['response', 'generateVideoResponse', 'generatedVideos', 0, 'video', 'uri'],
      ['response', 'generatedSamples', 0, 'video', 'uri'],
      ['response', 'generatedSamples', 0, 'video', 'videoUri'],
      ['response', 'generatedVideos', 0, 'video', 'uri'],
      ['response', 'videos', 0, 'video', 'uri'],
      ['response', 'videos', 0, 'uri']
    ]
  )
  candidate.to_s.strip
end

def looks_like_base64_payload(value)
  raw = value.to_s.gsub(/\s+/, '')
  return false if raw.length < 120

  raw.match?(/\A[A-Za-z0-9+\/=]+\z/)
end

def collect_gemini_video_candidates(node, uris, base64_values, mime_types)
  if node.is_a?(Hash)
    node.each do |key, value|
      lowered_key = key.to_s.downcase
      if value.is_a?(String)
        stripped = value.strip
        if lowered_key.include?('uri') || lowered_key.include?('url')
          uris << stripped unless stripped.empty?
        end
        if lowered_key.include?('base64') || lowered_key.include?('bytesbase64encoded') || lowered_key == 'data'
          base64_values << stripped if looks_like_base64_payload(stripped)
        end
        if lowered_key.include?('mimetype') || lowered_key == 'mime_type' || lowered_key.include?('contenttype')
          mime_types << stripped unless stripped.empty?
        end
      end
      collect_gemini_video_candidates(value, uris, base64_values, mime_types)
    end
  elsif node.is_a?(Array)
    node.each { |value| collect_gemini_video_candidates(value, uris, base64_values, mime_types) }
  end
end

def score_video_uri_candidate(uri)
  value = uri.to_s.strip
  return -100 if value.empty?
  return -50 if value.start_with?('operations/')

  score = 0
  score += 4 if value.start_with?('http://', 'https://')
  score += 2 if value.downcase.include?('video')
  score += 2 if value.downcase.include?('download')
  score += 2 if value.downcase.include?('.mp4')
  score += 1 if value.downcase.include?('googleapis.com')
  score
end

def extract_gemini_video_payload(data)
  direct_uri = extract_gemini_video_uri(data)
  return { video_uri: direct_uri, video_base64: '', mime_type: '' } unless direct_uri.empty?

  uris = []
  base64_values = []
  mime_types = []
  collect_gemini_video_candidates(data, uris, base64_values, mime_types)

  best_uri = uris.uniq.max_by { |candidate| score_video_uri_candidate(candidate) }.to_s.strip
  best_uri = '' if score_video_uri_candidate(best_uri) <= 0

  best_base64 = base64_values.uniq.first.to_s.strip
  best_mime_type = mime_types.find { |mime| mime.to_s.downcase.start_with?('video/') }.to_s.strip
  best_mime_type = 'video/mp4' if best_mime_type.empty? && !best_base64.empty?

  {
    video_uri: best_uri,
    video_base64: best_base64,
    mime_type: best_mime_type
  }
end

def extract_gemini_filtered_reasons(data)
  return [] unless data.is_a?(Hash)

  reasons_candidate = first_present_value(
    data,
    [
      ['response', 'generateVideoResponse', 'raiMediaFilteredReasons'],
      ['response', 'raiMediaFilteredReasons'],
      ['generateVideoResponse', 'raiMediaFilteredReasons']
    ]
  )

  reasons = if reasons_candidate.is_a?(Array)
              reasons_candidate
            elsif reasons_candidate.nil?
              []
            else
              [reasons_candidate]
            end

  normalized = reasons.map { |reason| squeeze_space(reason.to_s) }.reject(&:empty?).uniq
  return normalized unless normalized.empty?

  filtered_count = first_present_value(
    data,
    [
      ['response', 'generateVideoResponse', 'raiMediaFilteredCount'],
      ['response', 'raiMediaFilteredCount'],
      ['generateVideoResponse', 'raiMediaFilteredCount']
    ]
  ).to_i

  return [] if filtered_count <= 0

  ['Gemini filtered the generated media for policy/safety reasons.']
end

def compact_json_preview(data, max_chars = 900)
  return '' unless data.is_a?(Hash) || data.is_a?(Array)

  serialized = JSON.generate(data)
  return serialized if serialized.length <= max_chars

  "#{serialized[0, max_chars]}..."
rescue StandardError
  ''
end

def generate_video_with_gemini(prompt, aspect_ratio, duration_seconds, reference_image = nil)
  api_key = ENV.fetch('GEMINI_API_KEY', '').strip
  raise 'GEMINI_API_KEY is not set. Add it in your .env file.' if api_key.empty?

  base_url = ENV.fetch('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta').strip.sub(%r{/$}, '')
  model = ENV.fetch('GEMINI_VEO_MODEL', 'veo-3.1-generate-preview').strip
  timeout_sec = ENV.fetch('VIDEO_TIMEOUT_SEC', '120').to_i
  timeout_sec = 120 if timeout_sec <= 0
  poll_interval_ms = ENV.fetch('VIDEO_POLL_INTERVAL_MS', '2500').to_i
  poll_interval_ms = 2500 if poll_interval_ms <= 0
  poll_attempts = ENV.fetch('VIDEO_POLL_MAX_ATTEMPTS', '60').to_i
  poll_attempts = 60 if poll_attempts <= 0

  parameters = {
    'aspectRatio' => aspect_ratio.to_s,
    'durationSeconds' => duration_seconds.to_i
  }

  negative_prompt = ENV.fetch('GEMINI_NEGATIVE_PROMPT', '').strip
  parameters['negativePrompt'] = negative_prompt unless negative_prompt.empty?

  person_generation = ENV.fetch('GEMINI_PERSON_GENERATION', '').strip
  parameters['personGeneration'] = person_generation unless person_generation.empty?

  resolution = ENV.fetch('GEMINI_RESOLUTION', '').strip
  parameters['resolution'] = resolution unless resolution.empty?

  instance = { 'prompt' => prompt.to_s }
  if reference_image.is_a?(Hash)
    ref_base64 = reference_image[:base64].to_s.strip
    ref_mime_type = reference_image[:mime_type].to_s.strip
    unless ref_base64.empty?
      instance['image'] = {
        'bytesBase64Encoded' => ref_base64,
        'mimeType' => ref_mime_type.empty? ? 'image/png' : ref_mime_type
      }
    end
  end

  payload = {
    'instances' => [instance],
    'parameters' => parameters
  }

  start_url = "#{base_url}/models/#{model}:predictLongRunning"
  initial = http_request(
    method: 'POST',
    url: start_url,
    token: api_key,
    timeout_sec: timeout_sec,
    auth_header: 'x-goog-api-key',
    auth_prefix: '',
    json_body: payload
  )

  unless initial[:ok]
    extracted_error = extract_error_message(initial[:data])
    error_text = extracted_error.empty? ? initial[:raw_text].to_s : extracted_error
    raise "Gemini start request failed (HTTP #{initial[:status_code]}): #{error_text}"
  end

  initial_data = initial[:data]
  unless initial_data.is_a?(Hash)
    raise 'Gemini start request returned an unexpected response shape.'
  end

  operation_name = extract_gemini_operation_name(initial_data)
  raise 'Gemini did not return an operation name.' if operation_name.empty?

  poll_url = "#{base_url}/#{operation_name}"
  poll_attempts.times do
    sleep(poll_interval_ms / 1000.0)

    poll = http_request(
      method: 'GET',
      url: poll_url,
      token: api_key,
      timeout_sec: timeout_sec,
      auth_header: 'x-goog-api-key',
      auth_prefix: '',
      json_body: nil
    )

    unless poll[:ok]
      extracted_error = extract_error_message(poll[:data])
      error_text = extracted_error.empty? ? poll[:raw_text].to_s : extracted_error
      raise "Gemini poll request failed (HTTP #{poll[:status_code]}): #{error_text}"
    end

    poll_data = poll[:data]
    next unless poll_data.is_a?(Hash)
    next unless poll_data['done'] == true

    operation_error = nested_get(poll_data, ['error', 'message']).to_s.strip
    raise operation_error unless operation_error.empty?

    filtered_reasons = extract_gemini_filtered_reasons(poll_data)
    unless filtered_reasons.empty?
      raise "Gemini filtered this video attempt: #{filtered_reasons.join(' | ')}"
    end

    video_payload = extract_gemini_video_payload(poll_data)
    video_base64 = video_payload[:video_base64].to_s.strip
    unless video_base64.empty?
      return {
        status: 'completed',
        video_base64: video_base64,
        mime_type: video_payload[:mime_type].to_s.strip.empty? ? 'video/mp4' : video_payload[:mime_type].to_s.strip
      }
    end

    video_uri = video_payload[:video_uri].to_s.strip
    if video_uri.empty?
      response_preview = compact_json_preview(poll_data)
      if response_preview.empty?
        raise 'Gemini operation finished but no video URI was returned.'
      else
        raise "Gemini operation finished but no video URI was returned. Response preview: #{response_preview}"
      end
    end

    download = http_request(
      method: 'GET',
      url: video_uri,
      token: api_key,
      timeout_sec: timeout_sec,
      auth_header: 'x-goog-api-key',
      auth_prefix: '',
      json_body: nil,
      follow_redirects: true,
      max_redirects: 5
    )

    if download[:kind] == :binary_video
      return {
        binary: true,
        content_type: download[:content_type],
        body: download[:body]
      }
    end

    unless download[:ok]
      extracted_error = extract_error_message(download[:data])
      error_text = extracted_error.empty? ? download[:raw_text].to_s : extracted_error
      raise "Gemini video download failed (HTTP #{download[:status_code]}): #{error_text}"
    end

    return {
      status: 'completed',
      video_url: video_uri
    }
  end

  raise 'Timed out waiting for Gemini Veo generation.'
end

def generate_video(prompt, aspect_ratio, duration_seconds, reference_image = nil)
  provider = ENV.fetch('VIDEO_PROVIDER', '').strip.downcase
  gemini_key = ENV.fetch('GEMINI_API_KEY', '').strip
  if provider == 'gemini_veo' || provider == 'google_veo' || (provider.empty? && !gemini_key.empty?)
    return generate_video_with_gemini(prompt, aspect_ratio, duration_seconds, reference_image)
  end

  api_url = ENV.fetch('VIDEO_API_URL', '').strip
  if api_url.empty?
    demo_video_url = ENV.fetch('DEMO_VIDEO_URL', 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4').strip
    return {
      status: 'demo',
      video_url: demo_video_url
    }
  end

  token = ENV.fetch('VIDEO_API_TOKEN', '').strip
  auth_header = ENV.fetch('VIDEO_API_AUTH_HEADER', 'Authorization').strip
  auth_prefix = ENV.fetch('VIDEO_API_AUTH_PREFIX', 'Bearer').strip
  model = ENV.fetch('VIDEO_MODEL', 'veo-3').strip
  timeout_sec = ENV.fetch('VIDEO_TIMEOUT_SEC', '120').to_i
  timeout_sec = 120 if timeout_sec <= 0
  poll_interval_ms = ENV.fetch('VIDEO_POLL_INTERVAL_MS', '2500').to_i
  poll_interval_ms = 2500 if poll_interval_ms <= 0
  poll_attempts = ENV.fetch('VIDEO_POLL_MAX_ATTEMPTS', '60').to_i
  poll_attempts = 60 if poll_attempts <= 0

  payload_style = ENV.fetch('VIDEO_PAYLOAD_STYLE', 'prompt').strip
  payload = case payload_style
            when 'input'
              {
                'model' => model,
                'input' => prompt,
                'duration_seconds' => duration_seconds,
                'aspect_ratio' => aspect_ratio
              }
            when 'prompt_text'
              {
                'model' => model,
                'prompt' => { 'text' => prompt },
                'duration_seconds' => duration_seconds,
                'aspect_ratio' => aspect_ratio
              }
            else
              {
                'model' => model,
                'prompt' => prompt,
                'duration_seconds' => duration_seconds,
                'aspect_ratio' => aspect_ratio
              }
            end

  if reference_image.is_a?(Hash)
    ref_base64 = reference_image[:base64].to_s.strip
    ref_mime_type = reference_image[:mime_type].to_s.strip
    unless ref_base64.empty?
      payload['reference_image_base64'] = ref_base64
      payload['reference_image_mime_type'] = ref_mime_type.empty? ? 'image/png' : ref_mime_type
    end
  end

  initial = http_request(
    method: 'POST',
    url: api_url,
    token: token,
    timeout_sec: timeout_sec,
    auth_header: auth_header,
    auth_prefix: auth_prefix,
    json_body: payload
  )

  if initial[:kind] == :binary_video
    return {
      binary: true,
      content_type: initial[:content_type],
      body: initial[:body]
    }
  end

  unless initial[:ok]
    extracted_error = extract_error_message(initial[:data])
    error_text = extracted_error.empty? ? initial[:raw_text].to_s : extracted_error
    raise "Upstream start request failed (HTTP #{initial[:status_code]}): #{error_text}"
  end

  parsed = initial[:data].nil? ? initial[:raw_text] : initial[:data]
  result = extract_video_result(parsed, api_url)

  return result unless result[:video_url].to_s.empty? && result[:video_base64].to_s.empty?

  if status_failed?(result[:status])
    raise result[:error_message].to_s.empty? ? "Upstream returned failed status: #{result[:status]}" : result[:error_message]
  end

  poll_url = build_poll_url(api_url, result[:poll_url], result[:job_id])

  if poll_url.empty? || (!status_pending?(result[:status]) && result[:status].to_s.empty? && result[:job_id].to_s.empty?)
    raise 'Upstream response did not include a video, poll URL, or recognizable pending status.'
  end

  poll_method = ENV.fetch('VIDEO_POLL_METHOD', 'GET').strip.upcase
  poll_method = 'GET' unless %w[GET POST].include?(poll_method)

  poll_attempts.times do
    sleep(poll_interval_ms / 1000.0)

    poll = http_request(
      method: poll_method,
      url: poll_url,
      token: token,
      timeout_sec: timeout_sec,
      auth_header: auth_header,
      auth_prefix: auth_prefix,
      json_body: nil
    )

    if poll[:kind] == :binary_video
      return {
        binary: true,
        content_type: poll[:content_type],
        body: poll[:body]
      }
    end

    unless poll[:ok]
      extracted_error = extract_error_message(poll[:data])
      error_text = extracted_error.empty? ? poll[:raw_text].to_s : extracted_error
      raise "Upstream poll request failed (HTTP #{poll[:status_code]}): #{error_text}"
    end

    poll_parsed = poll[:data].nil? ? poll[:raw_text] : poll[:data]
    poll_result = extract_video_result(poll_parsed, api_url)
    return poll_result unless poll_result[:video_url].to_s.empty? && poll_result[:video_base64].to_s.empty?

    if status_failed?(poll_result[:status])
      raise poll_result[:error_message].to_s.empty? ? "Upstream job failed with status: #{poll_result[:status]}" : poll_result[:error_message]
    end
  end

  raise 'Timed out waiting for upstream video generation.'
end

def extract_gemini_image_inline_data(data)
  return {} unless data.is_a?(Hash)

  candidates = data['candidates']
  return {} unless candidates.is_a?(Array)

  candidates.each do |candidate|
    parts = nested_get(candidate, ['content', 'parts'])
    next unless parts.is_a?(Array)

    parts.each do |part|
      next unless part.is_a?(Hash)

      inline = part['inlineData'] || part['inline_data']
      next unless inline.is_a?(Hash)

      image_data = inline['data'] || inline['bytesBase64Encoded']
      next if image_data.to_s.strip.empty?

      mime_type = inline['mimeType'] || inline['mime_type'] || 'image/png'
      return {
        image_base64: image_data.to_s,
        mime_type: mime_type.to_s
      }
    end
  end

  {}
end

def extract_imagen_image_prediction_data(data)
  return {} unless data.is_a?(Hash)

  predictions = data['predictions']
  return {} unless predictions.is_a?(Array)

  predictions.each do |prediction|
    next unless prediction.is_a?(Hash)

    image_data = first_present_value(
      prediction,
      [
        ['bytesBase64Encoded'],
        ['image', 'bytesBase64Encoded'],
        ['imageBytes']
      ]
    )
    next if image_data.to_s.strip.empty?

    mime_type = first_present_value(
      prediction,
      [
        ['mimeType'],
        ['mime_type'],
        ['image', 'mimeType'],
        ['image', 'mime_type']
      ]
    )

    return {
      image_base64: image_data.to_s,
      mime_type: mime_type.to_s.empty? ? 'image/png' : mime_type.to_s
    }
  end

  {}
end

def generate_character_image_with_gemini(prompt, aspect_ratio = '9:16')
  api_key = ENV.fetch('GEMINI_API_KEY', '').strip
  raise 'GEMINI_API_KEY is not set. Add it in your .env file.' if api_key.empty?

  base_url = ENV.fetch('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta').strip.sub(%r{/$}, '')
  model = ENV.fetch('GEMINI_IMAGE_MODEL', 'imagen-4.0-ultra-generate-001').strip
  timeout_sec = ENV.fetch('IMAGE_TIMEOUT_SEC', '90').to_i
  timeout_sec = 90 if timeout_sec <= 0

  if model.start_with?('imagen-')
    image_size = ENV.fetch('GEMINI_IMAGE_SIZE', '2K').strip
    sample_count = ENV.fetch('IMAGE_SAMPLE_COUNT', '1').to_i
    sample_count = 1 if sample_count <= 0
    sample_count = 4 if sample_count > 4
    person_generation = ENV.fetch('GEMINI_IMAGE_PERSON_GENERATION', ENV.fetch('GEMINI_PERSON_GENERATION', '')).strip
    safety_filter_level = ENV.fetch('GEMINI_IMAGE_SAFETY_FILTER_LEVEL', '').strip

    parameters = {
      'sampleCount' => sample_count
    }

    ratio = aspect_ratio.to_s.strip
    parameters['aspectRatio'] = ratio unless ratio.empty?
    parameters['imageSize'] = image_size unless image_size.empty?
    parameters['personGeneration'] = person_generation unless person_generation.empty?
    parameters['safetyFilterLevel'] = safety_filter_level unless safety_filter_level.empty?

    payload = {
      'instances' => [{ 'prompt' => prompt.to_s }],
      'parameters' => parameters
    }

    endpoint = "#{base_url}/models/#{model}:predict"
    response = http_request(
      method: 'POST',
      url: endpoint,
      token: api_key,
      timeout_sec: timeout_sec,
      auth_header: 'x-goog-api-key',
      auth_prefix: '',
      json_body: payload
    )

    unless response[:ok]
      extracted_error = extract_error_message(response[:data])
      error_text = extracted_error.empty? ? response[:raw_text].to_s : extracted_error
      raise "Imagen character image request failed (HTTP #{response[:status_code]}): #{error_text}"
    end

    data = response[:data]
    raise 'Imagen character image response was not JSON.' unless data.is_a?(Hash)

    image = extract_imagen_image_prediction_data(data)
    raise 'Imagen returned no base64 image data for character generation.' if image[:image_base64].to_s.empty?

    return {
      status: 'completed',
      image_base64: image[:image_base64],
      mime_type: image[:mime_type]
    }
  end

  payload = {
    'contents' => [
      {
        'parts' => [
          { 'text' => prompt.to_s }
        ]
      }
    ],
    'generationConfig' => {
      'responseModalities' => ['TEXT', 'IMAGE']
    }
  }

  endpoint = "#{base_url}/models/#{model}:generateContent"
  response = http_request(
    method: 'POST',
    url: endpoint,
    token: api_key,
    timeout_sec: timeout_sec,
    auth_header: 'x-goog-api-key',
    auth_prefix: '',
    json_body: payload
  )

  unless response[:ok]
    extracted_error = extract_error_message(response[:data])
    error_text = extracted_error.empty? ? response[:raw_text].to_s : extracted_error
    raise "Gemini character image request failed (HTTP #{response[:status_code]}): #{error_text}"
  end

  data = response[:data]
  raise 'Gemini character image response was not JSON.' unless data.is_a?(Hash)

  image = extract_gemini_image_inline_data(data)
  raise 'Gemini returned no inline image data for character generation.' if image[:image_base64].to_s.empty?

  {
    status: 'completed',
    image_base64: image[:image_base64],
    mime_type: image[:mime_type]
  }
end

def generate_character_image(prompt, aspect_ratio = '9:16')
  provider = ENV.fetch('VIDEO_PROVIDER', '').strip.downcase
  gemini_key = ENV.fetch('GEMINI_API_KEY', '').strip
  if provider == 'gemini_veo' || provider == 'google_veo' || (provider.empty? && !gemini_key.empty?)
    return generate_character_image_with_gemini(prompt, aspect_ratio)
  end

  demo_image_url = ENV.fetch('DEMO_CHARACTER_IMAGE_URL', 'https://picsum.photos/seed/character-preview/720/1280').strip
  {
    status: 'demo',
    image_url: demo_image_url
  }
end

def normalize_image_result_for_response(result)
  payload = {}
  payload['status'] = result[:status] unless result[:status].to_s.empty?
  payload['image_url'] = result[:image_url] unless result[:image_url].to_s.empty?
  payload['image_base64'] = result[:image_base64] unless result[:image_base64].to_s.empty?
  payload['mime_type'] = result[:mime_type] unless result[:mime_type].to_s.empty?
  payload
end

def json_response(response, status_code, data)
  response.status = status_code
  response['Content-Type'] = 'application/json'
  response.body = JSON.generate(data)
end

def set_common_headers(response)
  origin = ENV.fetch('WEB_CORS_ORIGIN', '*')
  response['Access-Control-Allow-Origin'] = origin
  response['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
  response['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
end

load_env_file(File.join(ROOT_DIR, '.env'))

port = ENV.fetch('PORT', '8791').to_i
port = 8791 if port <= 0

server = WEBrick::HTTPServer.new(
  Port: port,
  BindAddress: ENV.fetch('HOST', '0.0.0.0'),
  DocumentRoot: PUBLIC_DIR,
  AccessLog: [],
  Logger: WEBrick::Log.new($stderr, WEBrick::Log::INFO)
)

server.mount_proc('/healthz') do |request, response|
  set_common_headers(response)
  if request.request_method == 'OPTIONS'
    response.status = 204
    response.body = ''
  else
    json_response(response, 200, { ok: true })
  end
end

server.mount_proc('/api/generate-ai-logic') do |request, response|
  set_common_headers(response)

  if request.request_method == 'OPTIONS'
    response.status = 204
    response.body = ''
    next
  end

  unless request.request_method == 'POST'
    json_response(response, 405, { error: 'Method not allowed. Use POST.' })
    next
  end

  begin
    body = read_json_body(request)
    inputs = {
      'brandProduct' => body['brandProduct'],
      'brandGuidelines' => body['brandGuidelines'],
      'targetAudience' => body['targetAudience'],
      'funnelStage' => body['funnelStage'],
      'lockedScript' => body['lockedScript']
    }

    raise ArgumentError, 'brandProduct is required.' if inputs['brandProduct'].to_s.strip.empty?
    raise ArgumentError, 'brandGuidelines is required.' if inputs['brandGuidelines'].to_s.strip.empty?
    raise ArgumentError, 'targetAudience is required.' if inputs['targetAudience'].to_s.strip.empty?
    raise ArgumentError, 'funnelStage is required.' if inputs['funnelStage'].to_s.strip.empty?
    raise ArgumentError, 'lockedScript is required.' if inputs['lockedScript'].to_s.strip.empty?

    logic_result = generate_logic_with_gemini(inputs)
    json_response(response, 200, normalize_logic_result_for_response(logic_result))
  rescue ArgumentError => e
    json_response(response, 400, { error: e.message })
  rescue StandardError => e
    json_response(response, 502, { error: e.message })
  end
end

server.mount_proc('/api/generate-character-image') do |request, response|
  set_common_headers(response)

  if request.request_method == 'OPTIONS'
    response.status = 204
    response.body = ''
    next
  end

  unless request.request_method == 'POST'
    json_response(response, 405, { error: 'Method not allowed. Use POST.' })
    next
  end

  begin
    body = read_json_body(request)
    prompt = body['prompt'] || body['input'] || nested_get(body, ['prompt', 'text'])
    aspect_ratio = body['aspect_ratio'] || body['aspectRatio'] || '9:16'
    backstory = body['backstory'] || body['character_backstory'] || nested_get(body, ['context', 'backstory'])
    setting_profile = body['setting_profile'] || body['settingProfile'] || nested_get(body, ['context', 'settingProfile'])
    primary_activity = body['primary_activity'] || body['primaryActivity'] || nested_get(body, ['context', 'primaryActivity'])
    prompt_text = prompt.to_s.strip
    raise ArgumentError, 'Prompt is required.' if prompt_text.empty?
    sanitized_backstory = remove_screen_sentences(backstory)
    sanitized_backstory = remove_screen_terms(backstory) if sanitized_backstory.empty?
    unless sanitized_backstory.empty?
      prompt_text = "#{prompt_text} Backstory continuity anchor: #{sanitized_backstory}"
    end
    sanitized_setting = remove_screen_sentences(setting_profile)
    sanitized_activity = remove_screen_sentences(primary_activity)
    unless sanitized_setting.empty?
      prompt_text = "#{prompt_text} Lifestyle setting anchor: #{sanitized_setting}"
    end
    unless sanitized_activity.empty?
      prompt_text = "#{prompt_text} Activity anchor: #{sanitized_activity}"
    end
    prompt_text = append_indian_context(
      prompt_text,
      'Identity lock: Indian subject based in India, authentic Indian lifestyle context, facial features, and skin-tone realism.'
    )
    prompt_text = append_image_guardrails(prompt_text)

    image_result = generate_character_image(prompt_text, aspect_ratio.to_s)
    json_response(response, 200, normalize_image_result_for_response(image_result))
  rescue ArgumentError => e
    json_response(response, 400, { error: e.message })
  rescue StandardError => e
    json_response(response, 502, { error: e.message })
  end
end

server.mount_proc('/api/generate-educational-series') do |request, response|
  set_common_headers(response)

  if request.request_method == 'OPTIONS'
    response.status = 204
    response.body = ''
    next
  end

  unless request.request_method == 'POST'
    json_response(response, 405, { error: 'Method not allowed. Use POST.' })
    next
  end

  begin
    body = read_json_body(request)
    result = generate_educational_series(body)
    json_response(response, 200, result)
  rescue ArgumentError => e
    json_response(response, 400, { error: e.message })
  rescue StandardError => e
    json_response(response, 502, { error: e.message })
  end
end

server.mount_proc('/api/generate-video') do |request, response|
  set_common_headers(response)

  if request.request_method == 'OPTIONS'
    response.status = 204
    response.body = ''
    next
  end

  unless request.request_method == 'POST'
    json_response(response, 405, { error: 'Method not allowed. Use POST.' })
    next
  end

  begin
    body = read_json_body(request)
    prompt = body['prompt'] || body['input'] || nested_get(body, ['prompt', 'text'])
    aspect_ratio = body['aspect_ratio'] || body['aspectRatio'] || '16:9'
    duration_seconds = body['duration_seconds'] || body['durationSeconds'] || 8
    reference_image = extract_reference_image_from_body(body)

    prompt_text = prompt.to_s.strip
    raise ArgumentError, 'Prompt is required.' if prompt_text.empty?
    prompt_text = sanitize_video_prompt_text(prompt_text)

    generation_result = generate_video(prompt_text, aspect_ratio.to_s, duration_seconds.to_i, reference_image)

    if generation_result[:binary]
      response.status = 200
      response['Content-Type'] = generation_result[:content_type] || 'video/mp4'
      response.body = generation_result[:body]
    else
      json_response(response, 200, normalize_result_for_response(generation_result))
    end
  rescue ArgumentError => e
    json_response(response, 400, { error: e.message })
  rescue StandardError => e
    json_response(response, 502, { error: e.message })
  end
end

trap('INT') { server.shutdown }
trap('TERM') { server.shutdown }

puts "PTC Veo web app running on http://localhost:#{port}"
server.start
