# Sora Studio Product Branding

After a model video is generated, Sora Studio runs a post-processing step before the file is shown, copied to the recipient folder, or emailed.

The step can:

- overlay a product logo on the generated video
- append a product and funnel-specific end slate
- fall back to the generic Kotak end slate when a product-specific slate is not available

## Product And Funnel Detection

Branding is selected from the product, brief, business objective, and funnel text. The app reads the whole row, so the Product column can be broad as long as the brief mentions the actual product.

Current product profiles include:

- `air_plus`
- `cashback`
- `solitaire`
- `credit_card`
- `privy_business`
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

- `assets/end-slates/<profile>/<funnel>/<ratio>.mp4`
- `assets/end-slates/<profile>/<funnel>/default.mp4`
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

## Controls

Turn the entire post-processing step off:

```bash
SORA_STUDIO_BRANDING=false
```

Show job warnings when a logo is missing:

```bash
SORA_STUDIO_BRANDING_WARN_MISSING_LOGO=true
```
