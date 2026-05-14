import { Buffer } from "node:buffer";
import { google, gmail_v1 } from "googleapis";
import { createJob, mutateJob } from "@/app/lib/jobs";
import { EmailDeliveryConfig, JobCreateInput, JobRecord, ProductKey, VideoConfig, VideoType } from "@/app/lib/types";

const DEFAULT_GMAIL_WORKSPACE_USER = "neha@hypergro.ai";
const DEFAULT_GMAIL_PROCESSED_LABEL = "kotak-processed";
const DEFAULT_GMAIL_QUERY = `in:inbox is:unread -label:${DEFAULT_GMAIL_PROCESSED_LABEL}`;
const INTERNAL_APP_URL = (process.env.INTERNAL_APP_URL?.trim() || "http://127.0.0.1:3000").replace(/\/$/, "");
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || "";

function getServiceAccountCredentials():
  | { client_email: string; private_key: string }
  | null {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (json) {
    const parsed = JSON.parse(json) as { client_email?: string; private_key?: string };
    if (parsed.client_email && parsed.private_key) {
      return {
        client_email: parsed.client_email,
        private_key: parsed.private_key.replace(/\\n/g, "\n")
      };
    }
  }

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL?.trim() || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim() || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();

  if (!clientEmail || !privateKey) {
    return null;
  }

  return {
    client_email: clientEmail,
    private_key: privateKey.replace(/\\n/g, "\n")
  };
}

function requirePublicAppUrl(): string {
  if (!PUBLIC_APP_URL) {
    throw new Error("PUBLIC_APP_URL is required for Gmail replies with online video links.");
  }
  return PUBLIC_APP_URL;
}

function getWorkspaceMailbox(): string {
  return process.env.GMAIL_WORKSPACE_USER?.trim() || DEFAULT_GMAIL_WORKSPACE_USER;
}

async function getGmailClient(mailbox = getWorkspaceMailbox()): Promise<gmail_v1.Gmail> {
  const credentials = getServiceAccountCredentials();
  if (!credentials) {
    throw new Error("Google Workspace service account credentials are not configured.");
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.labels"
    ],
    subject: mailbox
  });

  return google.gmail({ version: "v1", auth });
}

function decodeBase64Url(input?: string | null): string {
  if (!input) {
    return "";
  }
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractMessageText(part?: gmail_v1.Schema$MessagePart): string {
  if (!part) {
    return "";
  }
  if (part.mimeType === "text/plain") {
    return decodeBase64Url(part.body?.data);
  }
  if (part.mimeType === "text/html") {
    return stripHtml(decodeBase64Url(part.body?.data));
  }
  if (Array.isArray(part.parts)) {
    const plain = part.parts.map((child) => extractMessageText(child)).filter(Boolean);
    return plain.join("\n\n").trim();
  }
  return "";
}

function getHeader(payload: gmail_v1.Schema$MessagePart | undefined, name: string): string {
  const header = payload?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase());
  return header?.value?.trim() || "";
}

function parseEmailAddress(raw: string): { email: string; name?: string } {
  const match = raw.match(/^(.*?)(?:<([^>]+)>)?$/);
  if (!match) {
    return { email: raw.trim() };
  }
  const name = match[1]?.replace(/(^"|"$)/g, "").trim();
  const email = (match[2] || match[1] || "").trim();
  return {
    email,
    name: name && name !== email ? name : undefined
  };
}

function inferProductKey(text: string): ProductKey {
  const lowered = text.toLowerCase();
  if (/\b(cashback\+?|cash back|fuel|grocer|groceries|milk|entertainment)\b/.test(lowered)) {
    return "kotak_cashback";
  }
  return "kotak_air_plus";
}

function inferVideoType(text: string): VideoType {
  const lowered = text.toLowerCase();
  if (/\bhow[\s-]?to\b/.test(lowered)) {
    return "how_to_video";
  }
  if (/\bmontage\b/.test(lowered)) {
    return "montage";
  }
  if (/\bhalf[\s-]?and[\s-]?half|feature\b/.test(lowered)) {
    return "features_half_half";
  }
  return "point_to_camera_multi_scene";
}

function inferVideoConfig(text: string): VideoConfig {
  const type = inferVideoType(text);
  if (type === "how_to_video") {
    return { type, durationSeconds: 20, provider: "sora" };
  }
  if (type === "point_to_camera_multi_scene" || type === "point_to_camera") {
    return { type, durationSeconds: 8, provider: "sora" };
  }
  if (/\b20\s*s(ec(ond)?)?\b/.test(text.toLowerCase())) {
    return { type, durationSeconds: 20, provider: "sora" };
  }
  if (/\b15\s*s(ec(ond)?)?\b/.test(text.toLowerCase())) {
    return { type, durationSeconds: 15, provider: "sora" };
  }
  return { type, durationSeconds: 8, provider: "sora" };
}

async function generateScriptFromBrief(input: {
  product: ProductKey;
  brief: string;
  video: VideoConfig;
}): Promise<string> {
  const response = await fetch(`${INTERNAL_APP_URL}/api/script`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      product: input.product,
      brief: input.brief,
      videoType: input.video.type,
      durationSeconds: input.video.durationSeconds
    })
  });

  const json = (await response.json()) as { script?: string; error?: string };
  if (!response.ok || !json.script) {
    throw new Error(json.error || `Script generation failed with status ${response.status}.`);
  }
  return json.script;
}

async function ensureProcessedLabelId(gmail: gmail_v1.Gmail, mailbox: string): Promise<string> {
  const labelName = process.env.GMAIL_PROCESSED_LABEL?.trim() || DEFAULT_GMAIL_PROCESSED_LABEL;
  const existing = await gmail.users.labels.list({ userId: mailbox });
  const match = existing.data.labels?.find((label) => label.name === labelName);
  if (match?.id) {
    return match.id;
  }

  const created = await gmail.users.labels.create({
    userId: mailbox,
    requestBody: {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show"
    }
  });

  if (!created.data.id) {
    throw new Error("Unable to create Gmail processed label.");
  }
  return created.data.id;
}

interface GmailInboundMessage {
  gmailMessageId: string;
  threadId: string;
  internetMessageId?: string;
  subject: string;
  fromEmail: string;
  fromName?: string;
  brief: string;
}

async function loadInboundMessage(
  gmail: gmail_v1.Gmail,
  mailbox: string,
  gmailMessageId: string
): Promise<GmailInboundMessage | null> {
  const response = await gmail.users.messages.get({
    userId: mailbox,
    id: gmailMessageId,
    format: "full"
  });
  const message = response.data;
  const payload = message.payload;
  const fromHeader = getHeader(payload, "From");
  const subject = getHeader(payload, "Subject") || "Kotak campaign brief";
  const internetMessageId = getHeader(payload, "Message-Id") || undefined;
  const { email, name } = parseEmailAddress(fromHeader);
  const briefBody = extractMessageText(payload);
  const brief = [subject, briefBody].filter(Boolean).join("\n\n").trim();

  if (!message.id || !message.threadId || !email || !brief) {
    return null;
  }

  return {
    gmailMessageId: message.id,
    threadId: message.threadId,
    internetMessageId,
    subject,
    fromEmail: email,
    fromName: name,
    brief
  };
}

export interface GmailPollResult {
  mailbox: string;
  jobs: JobRecord[];
  processedMessageIds: string[];
  skipped: number;
  errors: string[];
}

export async function pollGmailBriefInbox(): Promise<GmailPollResult> {
  const mailbox = getWorkspaceMailbox();
  const gmail = await getGmailClient(mailbox);
  const processedLabelId = await ensureProcessedLabelId(gmail, mailbox);
  const query = process.env.GMAIL_INBOX_QUERY?.trim() || DEFAULT_GMAIL_QUERY;
  const listed = await gmail.users.messages.list({
    userId: mailbox,
    q: query,
    maxResults: 10
  });

  const jobs: JobRecord[] = [];
  const processedMessageIds: string[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const item of listed.data.messages ?? []) {
    if (!item.id) {
      skipped += 1;
      continue;
    }

    try {
      const inbound = await loadInboundMessage(gmail, mailbox, item.id);
      if (!inbound) {
        skipped += 1;
        continue;
      }

      const product = inferProductKey(inbound.brief);
      const video = inferVideoConfig(inbound.brief);
      const script = await generateScriptFromBrief({
        product,
        brief: inbound.brief,
        video
      });

      const emailConfig: EmailDeliveryConfig = {
        provider: "gmail",
        mailbox,
        fromEmail: inbound.fromEmail,
        fromName: inbound.fromName,
        originalSubject: inbound.subject,
        threadId: inbound.threadId,
        gmailMessageId: inbound.gmailMessageId,
        internetMessageId: inbound.internetMessageId
      };

      const jobInput: JobCreateInput = {
        product,
        script,
        brief: inbound.brief,
        video,
        supers: {
          enabled: true,
          timingMode: "fast",
          template: "bottom_urgency",
          rules: []
        },
        email: emailConfig
      };

      const job = await createJob(jobInput);
      jobs.push(job);
      processedMessageIds.push(inbound.gmailMessageId);

      await gmail.users.messages.modify({
        userId: mailbox,
        id: inbound.gmailMessageId,
        requestBody: {
          addLabelIds: [processedLabelId],
          removeLabelIds: ["UNREAD"]
        }
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    mailbox,
    jobs,
    processedMessageIds,
    skipped,
    errors
  };
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildReplyBody(job: JobRecord): string {
  const publicBase = requirePublicAppUrl();
  const finalUrl = `${publicBase}/api/jobs/${job.id}/asset/final.mp4`;
  const squareUrl = `${publicBase}/api/jobs/${job.id}/asset/adapt-1x1.mp4`;
  const landscapeUrl = `${publicBase}/api/jobs/${job.id}/asset/adapt-16x9.mp4`;

  if (job.status === "completed") {
    const lines = [
      "Your Kotak video is ready.",
      "",
      `Product: ${job.product === "kotak_air_plus" ? "Kotak Air Plus" : "Kotak Cashback+"}`,
      `Script: ${job.script}`,
      "",
      `Final video: ${finalUrl}`
    ];
    if (job.assets.adaptSquareMp4) {
      lines.push(`Adapt 1:1: ${squareUrl}`);
    }
    if (job.assets.adaptLandscapeMp4) {
      lines.push(`Adapt 16:9: ${landscapeUrl}`);
    }
    return lines.join("\n");
  }

  return [
    "Your Kotak video request could not be completed.",
    "",
    `Brief: ${job.brief || "(not available)"}`,
    `Latest status: ${job.error || "Generation failed."}`
  ].join("\n");
}

async function sendReply(job: JobRecord): Promise<void> {
  if (job.email?.provider !== "gmail") {
    return;
  }
  if (job.email.replySentAt) {
    return;
  }

  const gmail = await getGmailClient(job.email.mailbox);
  const subject = /^re:/i.test(job.email.originalSubject) ? job.email.originalSubject : `Re: ${job.email.originalSubject}`;
  const body = buildReplyBody(job);
  const rawLines = [
    `To: ${job.email.fromName ? `"${job.email.fromName}" <${job.email.fromEmail}>` : job.email.fromEmail}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    job.email.internetMessageId ? `In-Reply-To: ${job.email.internetMessageId}` : "",
    job.email.internetMessageId ? `References: ${job.email.internetMessageId}` : "",
    "",
    body
  ].filter(Boolean);

  await gmail.users.messages.send({
    userId: job.email.mailbox,
    requestBody: {
      threadId: job.email.threadId,
      raw: toBase64Url(rawLines.join("\r\n"))
    }
  });

  await mutateJob(job.id, (state) => {
    if (!state.email) {
      return;
    }
    state.email.replySentAt = new Date().toISOString();
    state.email.replyError = undefined;
  });
}

export async function maybeSendJobReply(job: JobRecord): Promise<void> {
  if (job.email?.provider !== "gmail") {
    return;
  }

  try {
    await sendReply(job);
  } catch (error) {
    await mutateJob(job.id, (state) => {
      if (!state.email) {
        return;
      }
      state.email.replyError = error instanceof Error ? error.message : String(error);
    });
    throw error;
  }
}
