# Sora Studio Product Branding

After a model video is generated, Sora Studio now runs a post-processing step before the file is shown, copied to the recipient folder, or emailed.

The step can:

- overlay a product logo on the generated video
- append a product-specific end slate
- fall back to the generic Kotak end slate when a product-specific slate is not available

## Product Detection

Branding is selected from the product, brief, business objective, and funnel text. Current built-in profiles include:

- `air_plus`
- `cashback`
- `solitaire`
- `privy_business`
- `home_loan`
- `personal_loan`
- `business_loan`
- `working_capital`
- `tax_payment`
- `pos`
- `generic`

## End Slates

The app first checks for product-specific assets:

- `assets/end-slates/<profile>-9x16.mp4`
- `assets/end-slates/<profile>-16x9.mp4`
- `assets/end-slates/<profile>.mp4`

If nothing is found, it uses the built-in files:

- Air Plus: `assets/end-slate-air-plus.mp4`
- Air Plus landscape: `assets/end-slate-air-plus-16x9.mp4`
- Cashback: `assets/end-slate-cashback.mp4`
- Generic: `assets/end-slate.mp4`

You can also override paths with environment variables:

- `SORA_STUDIO_<PROFILE>_END_SLATE_PATH`
- `SORA_STUDIO_<PROFILE>_9X16_END_SLATE_PATH`
- `SORA_STUDIO_<PROFILE>_16X9_END_SLATE_PATH`
- `SORA_STUDIO_DEFAULT_END_SLATE_PATH`

Example:

```bash
SORA_STUDIO_HOME_LOAN_END_SLATE_PATH=assets/end-slates/home_loan.mp4
```

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
