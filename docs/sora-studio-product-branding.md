# Sora Studio Product Branding

After a model video is generated, Sora Studio runs a post-processing step before the file is shown, copied to the recipient folder, or emailed.

The step can:

- overlay a product logo on the generated video
- burn captions from the generated VO/dialogue into the generated video
- append a product and funnel-specific end slate
- fall back to the generic Kotak end slate when a product-specific slate is not available

## Product And Funnel Detection

Branding is selected from the product, brief, business objective, and funnel text. The app reads the whole row, so the Product column can be broad as long as the brief mentions the actual product.

Current product profiles include:

- `privy_plus_business`
- `privy_business`
- `privy_plus`
- `privy`
- `solitaire_business`
- `league_credit_card`
- `everyday_plus`
- `air_plus`
- `cashback`
- `solitaire`
- `credit_card`
- `home_loan`
- `personal_loan`
- `savings_account`
- `business_account`
- `current_account`
- `business_loan`
- `working_capital`
- `tax_payment`
- `trade_services`
- `cash_management`
- `pos`
- `locker`
- `insurance`
- `mobile_banking`
- `generic`

Current funnel stages:

- `awareness`
- `consideration`
- `conversion`
- `retention`
- `generic`

The funnel is resolved from terms like `Awareness`, `Consideration`, `Conversion`, `Clicks`, `Lead Generation`, `Performance`, `BOFU`, `MOFU`, and `TOFU`.

## End Slates

The app first checks for product and funnel-specific assets:

- `assets/end-slates/<profile>/<funnel>/<variant>-<ratio>.mp4`
- `assets/end-slates/<profile>/<funnel>/<variant>.mp4`
- `assets/end-slates/<profile>/<funnel>/<ratio>.mp4`
- `assets/end-slates/<profile>/<funnel>/default-<ratio>.mp4`
- `assets/end-slates/<profile>/<funnel>/default.mp4`
- `assets/end-slates/<profile>/<variant>/<funnel>/<ratio>.mp4`
- `assets/end-slates/<profile>-<variant>-<funnel>-<ratio>.mp4`
- `assets/end-slates/<profile>-<funnel>-<ratio>.mp4`
- `assets/end-slates/<profile>_<funnel>_<ratio>.mp4`
- `assets/end-slates/<profile>-<funnel>.mp4`
- `assets/end-slates/<profile>_<funnel>.mp4`

- `assets/end-slates/<profile>-9x16.mp4`
- `assets/end-slates/<profile>-16x9.mp4`
- `assets/end-slates/<profile>.mp4`

Then it checks funnel-only generic slates:

- `assets/end-slates/generic/<funnel>/<ratio>.mp4`
- `assets/end-slates/generic-<funnel>-<ratio>.mp4`
- `assets/end-slates/generic_<funnel>_<ratio>.mp4`
- `assets/end-slates/generic-<funnel>.mp4`
- `assets/end-slates/generic_<funnel>.mp4`

If nothing is found, it uses the built-in files:

- Air Plus: `assets/end-slate-air-plus.mp4`
- Air Plus landscape: `assets/end-slate-air-plus-16x9.mp4`
- Cashback: `assets/end-slate-cashback.mp4`
- Generic: `assets/end-slate.mp4`

You can also override paths with environment variables:

- `SORA_STUDIO_<PROFILE>_<FUNNEL>_END_SLATE_PATH`
- `SORA_STUDIO_<PROFILE>_<FUNNEL>_9X16_END_SLATE_PATH`
- `SORA_STUDIO_<PROFILE>_<FUNNEL>_16X9_END_SLATE_PATH`
- `SORA_STUDIO_<PROFILE>_END_SLATE_PATH`
- `SORA_STUDIO_<PROFILE>_9X16_END_SLATE_PATH`
- `SORA_STUDIO_<PROFILE>_16X9_END_SLATE_PATH`
- `SORA_STUDIO_<FUNNEL>_END_SLATE_PATH`
- `SORA_STUDIO_<FUNNEL>_9X16_END_SLATE_PATH`
- `SORA_STUDIO_<FUNNEL>_16X9_END_SLATE_PATH`
- `SORA_STUDIO_DEFAULT_END_SLATE_PATH`

Example:

```bash
SORA_STUDIO_HOME_LOAN_CONVERSION_END_SLATE_PATH=assets/end-slates/home_loan-conversion-9x16.mp4
```

Recommended naming when you add MP4s:

```text
assets/end-slates/home_loan-conversion-9x16.mp4
assets/end-slates/home_loan-awareness-9x16.mp4
assets/end-slates/air_plus-consideration-9x16.mp4
assets/end-slates/cashback-conversion-9x16.mp4
assets/end-slates/generic-conversion-9x16.mp4
```

For landscape videos, use `16x9` in the file name.

The attached Kotak end-frame pack is mapped into `assets/end-slates/` and indexed in
`docs/sora-studio-end-slate-asset-manifest.json`. These are curated app assets, not generated batch outputs.

## Variant Matching

When the sheet or brief mentions a more specific angle, the app now chooses that variant before falling back to the product default.

Examples:

```text
Privy + Locker rent + Consideration -> assets/end-slates/privy_plus/consideration/locker-9x16.mp4
Taxes + GST pre-approved loan -> assets/end-slates/tax_payment/awareness/gst_lending-9x16.mp4
Working Capital + Solar Funding -> assets/end-slates/working_capital/awareness/solar_funding-9x16.mp4
Solitaire Business + Import/Export -> assets/end-slates/solitaire_business/awareness/import_export-9x16.mp4
```

If a conversion slate is missing, lookup falls back in this order:

```text
conversion -> consideration -> awareness -> generic
```

So a conversion brief can still use the closest available product-specific end frame instead of dropping to the generic slate.

Excel imports also merge a `Segment` column with `Product` when both are present. For example, `Privy+` plus `Locker rent` becomes `Privy+ Locker rent` for branding detection.

## Logos

Logo files can be placed at:

- `assets/product-logos/<profile>.png`
- `assets/product-logos/<profile>.jpg`
- `assets/product-logos/<profile>.webp`
- `assets/brand-logos/<profile>.png`
- `assets/logo-<profile>.png`

The generic fallback can be:

- `assets/product-logos/generic.png`
- `assets/brand-logos/generic.png`
- `assets/logo.png`

You can override logos with:

- `SORA_STUDIO_<PROFILE>_LOGO_PATH`
- `SORA_STUDIO_DEFAULT_LOGO_PATH`

Example:

```bash
SORA_STUDIO_CASHBACK_LOGO_PATH=assets/product-logos/cashback.png
```

## Captions

Sora Studio can burn captions into every generated video before attaching the end slate.
Captions are created from the generated video's actual audio through OpenAI Whisper, using word-level timestamps when available.
The generated screenplay is sent only as transcription context so product names and offer terms are more likely to be spelled correctly.
Whisper captioning uses the same `OPENAI_API_KEY` environment variable as direct Sora generation.

If Whisper cannot run, captions are skipped and the video still completes with branding and end slate. You can optionally allow a screenplay-timed fallback.

Controls:

```bash
SORA_STUDIO_CAPTIONS=false
SORA_STUDIO_CAPTION_TRANSCRIPTION_MODEL=whisper-1
SORA_STUDIO_CAPTION_TRANSCRIPTION_TIMEOUT_MS=120000
SORA_STUDIO_CAPTION_AUDIO_MAX_MB=24
SORA_STUDIO_CAPTIONS_SCRIPT_FALLBACK=true
SORA_STUDIO_CAPTION_PORTRAIT_BOTTOM_MARGIN_PX=620
SORA_STUDIO_CAPTION_LANDSCAPE_BOTTOM_MARGIN_PX=120
SORA_STUDIO_SEEDANCE_PRONUNCIATION_LOCK=true
```

The current caption style is `boxed_bottom`: bold white text in a subtle dark box near the lower part of the generated video, raised above short-form video UI safe space. The end slate itself is not captioned.

Seedance renders also include a pronunciation lock for terms such as `forex`, `Solitaire`, `Kotak`, `lakh`, `EMI`, and Hindi/Devanagari words when they appear in the job. This is instruction-only audio guidance and does not change the locked Dialogue/VO wording.

## Controls

Turn the logo and end-slate branding off:

```bash
SORA_STUDIO_BRANDING=false
```

Show job warnings when a logo is missing:

```bash
SORA_STUDIO_BRANDING_WARN_MISSING_LOGO=true
```
