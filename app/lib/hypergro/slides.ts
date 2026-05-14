import { google, slides_v1 } from "googleapis";
import { DECK_THEME, TEMPLATE_LABELS } from "@/app/lib/hypergro/templates";
import { DeckColumn, DeckDocument, DeckMetric, DeckSlide, DeckTemplateId, DeckTimelineItem, SlidesRenderInfo } from "@/app/lib/hypergro/types";

const SLIDE_WIDTH = 960;
const SLIDE_HEIGHT = 540;

type SlidesRequest = slides_v1.Schema$Request;

interface ThemePalette {
  background: string;
  title: string;
  body: string;
  accent: string;
  accentSecondary: string;
  card: string;
  muted: string;
}

function getSlidesCredentials():
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

function pt(value: number): slides_v1.Schema$Dimension {
  return {
    magnitude: value,
    unit: "PT"
  };
}

function transform(x: number, y: number): slides_v1.Schema$AffineTransform {
  return {
    scaleX: 1,
    scaleY: 1,
    translateX: x,
    translateY: y,
    unit: "PT"
  };
}

function hexToRgb(hex: string): { red: number; green: number; blue: number } {
  const value = hex.replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((chunk) => `${chunk}${chunk}`).join("") : value;
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  return { red, green, blue };
}

function opaqueColor(hex: string): slides_v1.Schema$OpaqueColor {
  return {
    rgbColor: hexToRgb(hex)
  };
}

function fullTextRange(): slides_v1.Schema$Range {
  return { type: "ALL" };
}

function backgroundRequest(slideId: string, objectId: string, color: string): SlidesRequest[] {
  return [
    {
      createShape: {
        objectId,
        shapeType: "RECTANGLE",
        elementProperties: {
          pageObjectId: slideId,
          size: {
            width: pt(SLIDE_WIDTH),
            height: pt(SLIDE_HEIGHT)
          },
          transform: transform(0, 0)
        }
      }
    },
    {
      updateShapeProperties: {
        objectId,
        fields: "shapeBackgroundFill.solidFill.color,shapeBackgroundFill.propertyState,outline.propertyState",
        shapeProperties: {
          shapeBackgroundFill: {
            propertyState: "RENDERED",
            solidFill: {
              color: opaqueColor(color)
            }
          },
          outline: {
            propertyState: "NOT_RENDERED"
          }
        }
      }
    }
  ];
}

function createPanel(
  slideId: string,
  objectId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  radiusShape: "RECTANGLE" | "ROUND_RECTANGLE" = "ROUND_RECTANGLE",
  alpha?: number
): SlidesRequest[] {
  return [
    {
      createShape: {
        objectId,
        shapeType: radiusShape,
        elementProperties: {
          pageObjectId: slideId,
          size: {
            width: pt(width),
            height: pt(height)
          },
          transform: transform(x, y)
        }
      }
    },
    {
      updateShapeProperties: {
        objectId,
        fields: "shapeBackgroundFill.solidFill.color,shapeBackgroundFill.solidFill.alpha,shapeBackgroundFill.propertyState,outline.propertyState",
        shapeProperties: {
          shapeBackgroundFill: {
            propertyState: "RENDERED",
            solidFill: {
              color: opaqueColor(fill),
              alpha
            }
          },
          outline: {
            propertyState: "NOT_RENDERED"
          }
        }
      }
    }
  ];
}

interface TextBoxOptions {
  fontSize: number;
  color: string;
  bold?: boolean;
  align?: "START" | "CENTER" | "END";
  fill?: string;
  fontFamily?: string;
  shapeType?: "TEXT_BOX" | "ROUND_RECTANGLE" | "RECTANGLE";
  alpha?: number;
}

function createTextBox(
  slideId: string,
  objectId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  options: TextBoxOptions
): SlidesRequest[] {
  const shapeType = options.shapeType ?? "TEXT_BOX";
  const requests: SlidesRequest[] = [
    {
      createShape: {
        objectId,
        shapeType,
        elementProperties: {
          pageObjectId: slideId,
          size: {
            width: pt(width),
            height: pt(height)
          },
          transform: transform(x, y)
        }
      }
    },
    {
      insertText: {
        objectId,
        text
      }
    },
    {
      updateTextStyle: {
        objectId,
        fields: "fontFamily,fontSize,bold,foregroundColor",
        style: {
          fontFamily: options.fontFamily ?? "Source Sans 3",
          fontSize: pt(options.fontSize),
          bold: options.bold ?? false,
          foregroundColor: {
            opaqueColor: opaqueColor(options.color)
          }
        },
        textRange: fullTextRange()
      }
    }
  ];

  if (options.align) {
    requests.push({
      updateParagraphStyle: {
        objectId,
        fields: "alignment",
        style: {
          alignment: options.align
        },
        textRange: fullTextRange()
      }
    });
  }

  if (options.fill) {
    requests.push({
      updateShapeProperties: {
        objectId,
        fields:
          "shapeBackgroundFill.solidFill.color,shapeBackgroundFill.solidFill.alpha,shapeBackgroundFill.propertyState,outline.propertyState,contentAlignment",
        shapeProperties: {
          contentAlignment: "MIDDLE",
          shapeBackgroundFill: {
            propertyState: "RENDERED",
            solidFill: {
              color: opaqueColor(options.fill),
              alpha: options.alpha
            }
          },
          outline: {
            propertyState: "NOT_RENDERED"
          }
        }
      }
    });
  } else {
    requests.push({
      updateShapeProperties: {
        objectId,
        fields: "shapeBackgroundFill.propertyState,outline.propertyState",
        shapeProperties: {
          shapeBackgroundFill: {
            propertyState: "NOT_RENDERED"
          },
          outline: {
            propertyState: "NOT_RENDERED"
          }
        }
      }
    });
  }

  return requests;
}

function truncateItems(items: string[] | undefined, count: number, fallback: string[]): string[] {
  const cleaned = (items ?? []).map((item) => item.trim()).filter(Boolean).slice(0, count);
  return cleaned.length > 0 ? cleaned : fallback.slice(0, count);
}

function normalizeMetrics(metrics: DeckMetric[]): DeckMetric[] {
  const fallback = [
    { label: "Illustrative upside", value: "2-3x", insight: "faster experimentation across channels" },
    { label: "Operating rhythm", value: "Weekly", insight: "decisioning through shared dashboards" },
    { label: "Commercial focus", value: "1 pilot", insight: "prove impact before scale-up" }
  ];
  return [...metrics.filter((metric) => metric.label && metric.value).slice(0, 3), ...fallback].slice(0, 3);
}

function normalizeColumns(columns: DeckColumn[]): DeckColumn[] {
  const fallback = [
    {
      title: "Growth systems",
      body: "Tighter loops between creative, media, and commerce operations.",
      bullets: ["Sharper prioritization", "Shared weekly rituals"]
    },
    {
      title: "Execution muscle",
      body: "Hands-on specialists move from insight to live activation quickly.",
      bullets: ["Cross-functional pods", "Lower coordination drag"]
    },
    {
      title: "Commercial outcomes",
      body: "Every workstream ties back to CAC, retention, or revenue quality.",
      bullets: ["Clear KPI ownership", "Measurable pilot design"]
    }
  ];
  return [...columns.filter((column) => column.title).slice(0, 3), ...fallback].slice(0, 3);
}

function normalizeTimeline(items: DeckTimelineItem[]): DeckTimelineItem[] {
  const fallback = [
    { phase: "01", title: "Diagnose", actions: ["Confirm growth thesis", "Align decision owners"] },
    { phase: "02", title: "Pilot", actions: ["Launch quick wins", "Track shared scorecard"] },
    { phase: "03", title: "Scale", actions: ["Codify plays", "Expand winning motions"] }
  ];
  return [...items.filter((item) => item.phase || item.title).slice(0, 3), ...fallback].slice(0, 3);
}

function paletteFor(templateId: DeckTemplateId): ThemePalette {
  switch (templateId) {
    case "cover":
    case "hypergro_edge":
    case "closing":
      return {
        background: DECK_THEME.navy,
        title: DECK_THEME.white,
        body: "#DCE5F0",
        accent: DECK_THEME.coral,
        accentSecondary: DECK_THEME.teal,
        card: "#14253C",
        muted: "#9CB0C8"
      };
    default:
      return {
        background: DECK_THEME.paper,
        title: DECK_THEME.ink,
        body: DECK_THEME.slate,
        accent: DECK_THEME.coral,
        accentSecondary: DECK_THEME.teal,
        card: DECK_THEME.white,
        muted: "#B9C4D4"
      };
  }
}

function renderHeaderBand(slideId: string, slideIndex: number, palette: ThemePalette): SlidesRequest[] {
  return [
    ...createPanel(slideId, `${slideId}_band`, 56, 34, 78, 8, palette.accent, "RECTANGLE"),
    ...createTextBox(slideId, `${slideId}_folio`, 805, 32, 90, 24, `0${slideIndex + 1}`, {
      fontSize: 12,
      color: palette.body,
      bold: true,
      align: "END"
    })
  ];
}

function renderMetricCards(slideId: string, metrics: DeckMetric[], palette: ThemePalette, top = 160): SlidesRequest[] {
  return normalizeMetrics(metrics).flatMap((metric, index) => {
    const x = 602;
    const y = top + index * 104;
    return [
      ...createTextBox(slideId, `${slideId}_metric_${index}`, x, y, 282, 86, `${metric.label}\n${metric.value}\n${metric.insight}`, {
        fontSize: 16,
        color: palette.title,
        bold: false,
        fill: palette.card,
        shapeType: "ROUND_RECTANGLE",
        alpha: palette.background === DECK_THEME.navy ? 0.92 : 1
      }),
      {
        updateTextStyle: {
          objectId: `${slideId}_metric_${index}`,
          fields: "fontFamily,fontSize,bold,foregroundColor",
          style: {
            fontFamily: "Source Sans 3",
            fontSize: pt(12),
            bold: true,
            foregroundColor: {
              opaqueColor: opaqueColor(palette.accentSecondary)
            }
          },
          textRange: {
            type: "FIXED_RANGE",
            startIndex: 0,
            endIndex: metric.label.length
          }
        }
      },
      {
        updateTextStyle: {
          objectId: `${slideId}_metric_${index}`,
          fields: "fontFamily,fontSize,bold,foregroundColor",
          style: {
            fontFamily: "Source Sans 3",
            fontSize: pt(24),
            bold: true,
            foregroundColor: {
              opaqueColor: opaqueColor(palette.accent)
            }
          },
          textRange: {
            type: "FIXED_RANGE",
            startIndex: metric.label.length + 1,
            endIndex: metric.label.length + 1 + metric.value.length
          }
        }
      }
    ];
  });
}

function renderColumns(slideId: string, columns: DeckColumn[], palette: ThemePalette, y = 238): SlidesRequest[] {
  return normalizeColumns(columns).flatMap((column, index) => {
    const x = 56 + index * 280;
    const bulletText = truncateItems(column.bullets, 2, ["Shared KPI ownership", "Weekly executive check-ins"])
      .map((item) => `• ${item}`)
      .join("\n");
    return [
      ...createTextBox(slideId, `${slideId}_col_${index}`, x, y, 244, 208, `${column.title}\n${column.body}\n${bulletText}`, {
        fontSize: 15,
        color: palette.title,
        fill: palette.card,
        shapeType: "ROUND_RECTANGLE"
      }),
      {
        updateTextStyle: {
          objectId: `${slideId}_col_${index}`,
          fields: "fontFamily,fontSize,bold,foregroundColor",
          style: {
            fontFamily: "Source Sans 3",
            fontSize: pt(19),
            bold: true,
            foregroundColor: {
              opaqueColor: opaqueColor(palette.accent)
            }
          },
          textRange: {
            type: "FIXED_RANGE",
            startIndex: 0,
            endIndex: column.title.length
          }
        }
      }
    ];
  });
}

function renderTimeline(slideId: string, items: DeckTimelineItem[], palette: ThemePalette): SlidesRequest[] {
  const normalized = normalizeTimeline(items);
  const requests: SlidesRequest[] = [
    ...createPanel(slideId, `${slideId}_axis`, 116, 260, 728, 2, palette.muted, "RECTANGLE")
  ];

  normalized.forEach((item, index) => {
    const x = 94 + index * 252;
    requests.push(
      ...createPanel(slideId, `${slideId}_dot_${index}`, x + 22, 246, 14, 14, palette.accent, "ROUND_RECTANGLE"),
      ...createTextBox(slideId, `${slideId}_phase_${index}`, x, 136, 188, 42, item.phase || `0${index + 1}`, {
        fontSize: 13,
        color: palette.accentSecondary,
        bold: true
      }),
      ...createTextBox(
        slideId,
        `${slideId}_road_${index}`,
        x,
        176,
        188,
        154,
        `${item.title}\n${truncateItems(item.actions, 2, ["Align owners", "Launch scorecard"]).map((action) => `• ${action}`).join("\n")}`,
        {
          fontSize: 15,
          color: palette.title,
          fill: palette.card,
          shapeType: "ROUND_RECTANGLE"
        }
      )
    );
  });

  return requests;
}

function slideTitleBlock(slideId: string, slide: DeckSlide, palette: ThemePalette): SlidesRequest[] {
  return [
    ...createTextBox(slideId, `${slideId}_kicker`, 56, 56, 360, 28, slide.kicker || TEMPLATE_LABELS[slide.templateId], {
      fontSize: 13,
      color: palette.accentSecondary,
      bold: true
    }),
    ...createTextBox(slideId, `${slideId}_title`, 56, 86, 480, 68, slide.title, {
      fontSize: 31,
      color: palette.title,
      bold: true,
      fontFamily: "Avenir Next"
    }),
    ...createTextBox(slideId, `${slideId}_headline`, 56, 162, 480, 60, slide.headline, {
      fontSize: 18,
      color: palette.body,
      bold: true
    })
  ];
}

function summaryAndBullets(slideId: string, slide: DeckSlide, palette: ThemePalette, y = 238): SlidesRequest[] {
  const bullets = truncateItems(slide.bullets, 4, [
    "Frame the operating problem in plain language",
    "Tie execution changes to commercial outcomes",
    "Keep roles and decisions visible on every slide"
  ]);
  return [
    ...createTextBox(slideId, `${slideId}_summary`, 56, y, 456, 72, slide.summary, {
      fontSize: 15,
      color: palette.body
    }),
    ...createTextBox(
      slideId,
      `${slideId}_bullets`,
      56,
      y + 86,
      456,
      152,
      bullets.map((item) => `• ${item}`).join("\n"),
      {
        fontSize: 16,
        color: palette.title
      }
    )
  ];
}

function renderCover(slideId: string, slide: DeckSlide, deck: DeckDocument, palette: ThemePalette, slideIndex: number): SlidesRequest[] {
  const metrics = normalizeMetrics(slide.metrics);
  return [
    ...backgroundRequest(slideId, `${slideId}_bg`, palette.background),
    ...createPanel(slideId, `${slideId}_shape_a`, 646, 44, 242, 178, palette.accent, "ROUND_RECTANGLE", 0.98),
    ...createPanel(slideId, `${slideId}_shape_b`, 722, 180, 132, 232, palette.accentSecondary, "ROUND_RECTANGLE", 0.9),
    ...createPanel(slideId, `${slideId}_shape_c`, 600, 320, 260, 150, "#203650", "ROUND_RECTANGLE", 1),
    ...renderHeaderBand(slideId, slideIndex, palette),
    ...createTextBox(slideId, `${slideId}_brand`, 56, 48, 220, 26, "HYPERGRO | HYPERGROWTH SALES DECK", {
      fontSize: 12,
      color: "#9EC4E2",
      bold: true
    }),
    ...createTextBox(slideId, `${slideId}_title`, 56, 108, 486, 82, deck.title, {
      fontSize: 40,
      color: palette.title,
      bold: true,
      fontFamily: "Avenir Next"
    }),
    ...createTextBox(slideId, `${slideId}_subtitle`, 56, 196, 470, 64, deck.subtitle, {
      fontSize: 21,
      color: palette.body
    }),
    ...createTextBox(slideId, `${slideId}_thesis`, 56, 316, 442, 98, deck.thesis, {
      fontSize: 18,
      color: palette.title,
      fill: "#13283F",
      shapeType: "ROUND_RECTANGLE",
      alpha: 0.96
    }),
    ...metrics.flatMap((metric, index) =>
      createTextBox(
        slideId,
        `${slideId}_badge_${index}`,
        56 + index * 150,
        440,
        136,
        58,
        `${metric.value}\n${metric.label}`,
        {
          fontSize: 14,
          color: palette.title,
          fill: index === 0 ? palette.accent : index === 1 ? "#1A3049" : "#163B35",
          shapeType: "ROUND_RECTANGLE"
        }
      )
    )
  ];
}

function renderExecutiveSummary(
  slideId: string,
  slide: DeckSlide,
  palette: ThemePalette,
  slideIndex: number
): SlidesRequest[] {
  return [
    ...backgroundRequest(slideId, `${slideId}_bg`, palette.background),
    ...renderHeaderBand(slideId, slideIndex, palette),
    ...slideTitleBlock(slideId, slide, palette),
    ...summaryAndBullets(slideId, slide, palette),
    ...renderMetricCards(slideId, slide.metrics, palette, 154),
    ...createTextBox(slideId, `${slideId}_callout`, 56, 452, 830, 42, slide.callout, {
      fontSize: 13,
      color: palette.body,
      fill: DECK_THEME.mist,
      shapeType: "ROUND_RECTANGLE"
    })
  ];
}

function renderMarketOpportunity(
  slideId: string,
  slide: DeckSlide,
  palette: ThemePalette,
  slideIndex: number
): SlidesRequest[] {
  return [
    ...backgroundRequest(slideId, `${slideId}_bg`, "#F6F1E8"),
    ...renderHeaderBand(slideId, slideIndex, palette),
    ...slideTitleBlock(slideId, slide, palette),
    ...createTextBox(slideId, `${slideId}_summary`, 56, 238, 830, 52, slide.summary, {
      fontSize: 16,
      color: palette.body
    }),
    ...renderColumns(slideId, slide.columns, palette, 304)
  ];
}

function renderPainPoints(slideId: string, slide: DeckSlide, palette: ThemePalette, slideIndex: number): SlidesRequest[] {
  return [
    ...backgroundRequest(slideId, `${slideId}_bg`, DECK_THEME.paper),
    ...renderHeaderBand(slideId, slideIndex, palette),
    ...slideTitleBlock(slideId, slide, palette),
    ...renderColumns(slideId, slide.columns, palette, 220),
    ...createTextBox(slideId, `${slideId}_callout`, 56, 452, 830, 42, slide.callout, {
      fontSize: 13,
      color: palette.body,
      fill: "#F0E6D7",
      shapeType: "ROUND_RECTANGLE"
    })
  ];
}

function renderHypergroEdge(slideId: string, slide: DeckSlide, palette: ThemePalette, slideIndex: number): SlidesRequest[] {
  return [
    ...backgroundRequest(slideId, `${slideId}_bg`, palette.background),
    ...renderHeaderBand(slideId, slideIndex, palette),
    ...slideTitleBlock(slideId, slide, palette),
    ...createTextBox(slideId, `${slideId}_summary`, 56, 228, 470, 64, slide.summary, {
      fontSize: 16,
      color: palette.body
    }),
    ...renderColumns(slideId, slide.columns, palette, 308),
    ...createTextBox(slideId, `${slideId}_badge`, 610, 118, 272, 52, slide.callout, {
      fontSize: 15,
      color: palette.title,
      fill: "#163B35",
      shapeType: "ROUND_RECTANGLE"
    })
  ];
}

function renderServiceStack(slideId: string, slide: DeckSlide, palette: ThemePalette, slideIndex: number): SlidesRequest[] {
  return [
    ...backgroundRequest(slideId, `${slideId}_bg`, "#FBF7F1"),
    ...renderHeaderBand(slideId, slideIndex, palette),
    ...slideTitleBlock(slideId, slide, palette),
    ...renderColumns(slideId, slide.columns, palette, 218),
    ...createTextBox(slideId, `${slideId}_cta`, 56, 452, 830, 42, slide.cta, {
      fontSize: 13,
      color: palette.title,
      fill: "#E8EEF6",
      shapeType: "ROUND_RECTANGLE"
    })
  ];
}

function renderProofPoints(slideId: string, slide: DeckSlide, palette: ThemePalette, slideIndex: number): SlidesRequest[] {
  return [
    ...backgroundRequest(slideId, `${slideId}_bg`, "#F4F6F8"),
    ...renderHeaderBand(slideId, slideIndex, palette),
    ...slideTitleBlock(slideId, slide, palette),
    ...renderMetricCards(slideId, slide.metrics, palette, 146),
    ...summaryAndBullets(slideId, slide, palette, 228)
  ];
}

function renderRoadmap(slideId: string, slide: DeckSlide, palette: ThemePalette, slideIndex: number): SlidesRequest[] {
  return [
    ...backgroundRequest(slideId, `${slideId}_bg`, "#F4EFE7"),
    ...renderHeaderBand(slideId, slideIndex, palette),
    ...slideTitleBlock(slideId, slide, palette),
    ...createTextBox(slideId, `${slideId}_callout`, 56, 224, 830, 38, slide.summary, {
      fontSize: 15,
      color: palette.body
    }),
    ...renderTimeline(slideId, slide.timeline, palette),
    ...createTextBox(slideId, `${slideId}_cta`, 56, 456, 830, 34, slide.cta, {
      fontSize: 13,
      color: palette.title
    })
  ];
}

function renderClosing(slideId: string, slide: DeckSlide, palette: ThemePalette, slideIndex: number): SlidesRequest[] {
  return [
    ...backgroundRequest(slideId, `${slideId}_bg`, palette.background),
    ...renderHeaderBand(slideId, slideIndex, palette),
    ...createTextBox(slideId, `${slideId}_title`, 56, 104, 520, 74, slide.title, {
      fontSize: 36,
      color: palette.title,
      bold: true,
      fontFamily: "Avenir Next"
    }),
    ...createTextBox(slideId, `${slideId}_headline`, 56, 188, 510, 58, slide.headline, {
      fontSize: 20,
      color: palette.body,
      bold: true
    }),
    ...createTextBox(
      slideId,
      `${slideId}_bullets`,
      56,
      270,
      434,
      152,
      truncateItems(slide.bullets, 4, ["Lock the initial pilot scope", "Align a weekly decision forum", "Define success metrics before launch"])
        .map((item) => `• ${item}`)
        .join("\n"),
      {
        fontSize: 17,
        color: palette.title
      }
    ),
    ...createTextBox(slideId, `${slideId}_cta`, 590, 172, 296, 214, `${slide.callout}\n\n${slide.cta}`, {
      fontSize: 18,
      color: palette.title,
      fill: "#14314D",
      shapeType: "ROUND_RECTANGLE"
    }),
    ...createTextBox(slideId, `${slideId}_footer`, 56, 464, 410, 28, slide.summary, {
      fontSize: 13,
      color: palette.body
    })
  ];
}

function renderSlide(slideId: string, slide: DeckSlide, deck: DeckDocument, slideIndex: number): SlidesRequest[] {
  const palette = paletteFor(slide.templateId);
  switch (slide.templateId) {
    case "cover":
      return renderCover(slideId, slide, deck, palette, slideIndex);
    case "executive_summary":
      return renderExecutiveSummary(slideId, slide, palette, slideIndex);
    case "market_opportunity":
      return renderMarketOpportunity(slideId, slide, palette, slideIndex);
    case "pain_points":
      return renderPainPoints(slideId, slide, palette, slideIndex);
    case "hypergro_edge":
      return renderHypergroEdge(slideId, slide, palette, slideIndex);
    case "service_stack":
      return renderServiceStack(slideId, slide, palette, slideIndex);
    case "proof_points":
      return renderProofPoints(slideId, slide, palette, slideIndex);
    case "execution_roadmap":
      return renderRoadmap(slideId, slide, palette, slideIndex);
    case "closing":
      return renderClosing(slideId, slide, palette, slideIndex);
  }
}

async function getSlidesClients(): Promise<{
  slides: slides_v1.Slides;
  drive: ReturnType<typeof google.drive>;
}> {
  const credentials = getSlidesCredentials();
  if (!credentials) {
    throw new Error("Google Slides credentials are not configured.");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/presentations",
      "https://www.googleapis.com/auth/drive"
    ]
  });

  return {
    slides: google.slides({ version: "v1", auth }),
    drive: google.drive({ version: "v3", auth })
  };
}

export function isSlidesRenderConfigured(): boolean {
  return Boolean(getSlidesCredentials());
}

export async function renderDeckToGoogleSlides(deck: DeckDocument): Promise<SlidesRenderInfo> {
  const { slides, drive } = await getSlidesClients();
  const created = await slides.presentations.create({
    requestBody: {
      title: deck.title
    }
  });

  const presentationId = created.data.presentationId;
  if (!presentationId) {
    throw new Error("Google Slides did not return a presentation ID.");
  }

  const defaultSlideId = created.data.slides?.[0]?.objectId;
  const requests: SlidesRequest[] = [];

  if (defaultSlideId) {
    requests.push({
      deleteObject: {
        objectId: defaultSlideId
      }
    });
  }

  deck.slides.forEach((slide, index) => {
    const slideId = `slide_${String(index + 1).padStart(2, "0")}`;
    requests.push({
      createSlide: {
        objectId: slideId
      }
    });
    requests.push(...renderSlide(slideId, slide, deck, index));
  });

  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: {
      requests
    }
  });

  const parentFolderId = process.env.GOOGLE_SLIDES_PARENT_FOLDER_ID?.trim();
  let folderUrl: string | undefined;

  if (parentFolderId) {
    const file = await drive.files.get({
      fileId: presentationId,
      fields: "parents"
    });

    await drive.files.update({
      fileId: presentationId,
      addParents: parentFolderId,
      removeParents: file.data.parents?.join(",") || undefined,
      fields: "id"
    });

    folderUrl = `https://drive.google.com/drive/folders/${parentFolderId}`;
  }

  return {
    status: "created",
    presentationId,
    presentationUrl: `https://docs.google.com/presentation/d/${presentationId}/edit`,
    folderUrl,
    message: "Deck rendered into Google Slides."
  };
}
