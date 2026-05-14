# Air Plus 3-Path Batch (5 briefs)

Date: 2026-03-28

Scope:
- product: Kotak Air Plus
- paths:
  - Sora 2 Pro (text-to-video)
  - Veo 3.1 Standard (shared image -> i2v)
  - Sora Image -> Veo I2V

Result summary:
- full 3-path completions: 0/5
- Sora text-to-video: 5/5 still running long
- Veo i2v: 5/5 failed
- Sora Image -> Veo I2V: 5/5 failed
- common Veo-side failure: `fetch failed`

| Case | RTB | Parent Run | Sora T2V | Veo I2V | Sora Image -> Veo I2V | Read |
|---|---|---|---|---|---|---|
| AP3-01 | 5% travel via Unbox | `1774716312474-ca094aac` | running | failed | failed | Veo branches failed immediately after launch |
| AP3-02 | 2% forex markup | `1774716312504-d14b6576` | running | failed | failed | Veo branches failed immediately after launch |
| AP3-03 | Complimentary flight at 1.5L quarterly spend | `1774716312527-2accfad0` | running | failed | failed | Veo branches failed immediately after launch |
| AP3-04 | Travel privileges worth 80K | `1774716312549-52e7281d` | running | failed | failed | Veo branches failed immediately after launch |
| AP3-05 | Zero joining fee | `1774716312572-c6da9234` | running | failed | failed | Veo branches failed immediately after launch |

Most important observation:
- the third-branch keyframe setup is now working
- the current batch bottleneck is no longer image-generation setup
- the current bottleneck is Veo-side generation/runtime stability, which is failing with `fetch failed`
- Sora text-to-video remained live but did not finish within the observed batch window
