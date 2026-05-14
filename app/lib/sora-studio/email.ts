import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import path from "node:path";
import { google, gmail_v1 } from "googleapis";
import { getSoraStudioJobDir, mutateSoraStudioJob, requireSoraStudioJob } from "./store";
import { SoraStudioJobRecord, SoraStudioRenderModelKey } from "./types";

const DEFAULT_GMAIL_WORKSPACE_USER = "neha@hypergro.ai";
const PUBLIC_APP_URL =
  process.env.SORA_STUDIO_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
  process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
  "";
const ATTACHMENT_MAX_BYTES = Math.max(
  1,
  Number(process.env.SORA_STUDIO_EMAIL_ATTACHMENT_MAX_MB ?? 20)
) * 1024 * 1024;

function getWorkspaceMailbox(): string {
  return process.env.GMAIL_WORKSPACE_USER?.trim() || DEFAULT_GMAIL_WORKSPACE_USER;
}

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

async function getGmailClient(mailbox = getWorkspaceMailbox()): Promise<gmail_v1.Gmail> {
  const credentials = getServiceAccountCredentials();
  if (!credentials) {
    throw new Error("Google Workspace service account credentials are not configured.");
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    subject: mailbox
  });

  return google.gmail({ version: "v1", auth });
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toMimeBase64(value: Buffer): string {
  return value.toString("base64").replace(/(.{76})/g, "$1\r\n");
}

function resolveRecipient(job: SoraStudioJobRecord): string | null {
  const rowRecipient = job.input.notificationEmail?.trim();
  if (rowRecipient) {
    return rowRecipient;
  }
  const defaultRecipient = process.env.SORA_STUDIO_NOTIFY_EMAIL_TO?.trim();
  return defaultRecipient || null;
}

function maybeBuildVideoUrl(jobId: string, assetFile: string): string | undefined {
  if (!PUBLIC_APP_URL) {
    return undefined;
  }
  return `${PUBLIC_APP_URL}/api/sora-studio/jobs/${jobId}/asset/${encodeURIComponent(assetFile)}?download=1`;
}

function buildEmailBody(params: {
  job: SoraStudioJobRecord;
  modelLabel: string;
  videoUrl?: string;
  attached: boolean;
}): string {
  const { job, modelLabel, videoUrl, attached } = params;
  const lines = [
    "A Sora Studio video is ready.",
    "",
    `Row: ${job.input.rowNumber}`,
    `Product: ${job.input.product}`,
    `Model: ${modelLabel}`,
    `Job ID: ${job.id}`,
    "",
    attached ? "The MP4 is attached to this email." : "The MP4 is available at the link below.",
    ...(videoUrl ? [`Video link: ${videoUrl}`] : []),
    "",
    "Brief:",
    job.input.brief,
    "",
    "Generated script:",
    job.script
  ];
  return lines.join("\n");
}

function buildPlainTextMessage(params: {
  toEmail: string;
  subject: string;
  body: string;
}): string {
  return [
    `To: ${params.toEmail}`,
    `Subject: ${params.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    params.body
  ].join("\r\n");
}

function buildAttachmentMessage(params: {
  toEmail: string;
  subject: string;
  body: string;
  attachmentFileName: string;
  attachmentBytes: Buffer;
}): string {
  const boundary = `sora-studio-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return [
    `To: ${params.toEmail}`,
    `Subject: ${params.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    params.body,
    "",
    `--${boundary}`,
    `Content-Type: video/mp4; name="${params.attachmentFileName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${params.attachmentFileName}"`,
    "",
    toMimeBase64(params.attachmentBytes),
    "",
    `--${boundary}--`,
    ""
  ].join("\r\n");
}

async function recordNotification(params: {
  jobId: string;
  modelKey: SoraStudioRenderModelKey;
  toEmail: string;
  assetFile?: string;
  videoUrl?: string;
  sentAt?: string;
  error?: string;
}): Promise<void> {
  const { jobId, modelKey, toEmail, assetFile, videoUrl, sentAt, error } = params;
  await mutateSoraStudioJob(jobId, (job) => {
    job.emailNotifications = {
      ...(job.emailNotifications ?? {}),
      [modelKey]: {
        toEmail,
        assetFile,
        videoUrl,
        sentAt,
        error
      }
    };
  });
}

export async function maybeSendSoraStudioRenderEmail(
  jobId: string,
  modelKey: SoraStudioRenderModelKey
): Promise<void> {
  if (process.env.SORA_STUDIO_EMAIL_NOTIFICATIONS?.trim().toLowerCase() === "false") {
    return;
  }

  const job = await requireSoraStudioJob(jobId);
  const render = job.renders?.find((item) => item.key === modelKey);
  const toEmail = resolveRecipient(job);

  if (!toEmail || render?.status !== "completed" || !render.assetFile) {
    return;
  }

  const previous = job.emailNotifications?.[modelKey];
  if (previous?.sentAt && previous.assetFile === render.assetFile && previous.toEmail === toEmail) {
    return;
  }

  try {
    const videoUrl = maybeBuildVideoUrl(job.id, render.assetFile);
    const filePath = path.join(getSoraStudioJobDir(job.id), render.assetFile);
    const attachmentBytes = await fs.readFile(filePath);
    const attachVideo = attachmentBytes.length <= ATTACHMENT_MAX_BYTES;

    if (!attachVideo && !videoUrl) {
      throw new Error(
        `Video is ${Math.ceil(attachmentBytes.length / (1024 * 1024))}MB, above the ${Math.floor(
          ATTACHMENT_MAX_BYTES / (1024 * 1024)
        )}MB attachment limit. Configure PUBLIC_APP_URL/SORA_STUDIO_PUBLIC_APP_URL for link delivery.`
      );
    }

    const gmail = await getGmailClient();
    const subject = `Sora Studio video ready: row ${job.input.rowNumber} - ${render.label}`;
    const body = buildEmailBody({
      job,
      modelLabel: render.label,
      videoUrl,
      attached: attachVideo
    });
    const raw = attachVideo
      ? buildAttachmentMessage({
          toEmail,
          subject,
          body,
          attachmentFileName: render.assetFile,
          attachmentBytes
        })
      : buildPlainTextMessage({
          toEmail,
          subject,
          body
        });

    await gmail.users.messages.send({
      userId: getWorkspaceMailbox(),
      requestBody: {
        raw: toBase64Url(raw)
      }
    });

    await recordNotification({
      jobId: job.id,
      modelKey,
      toEmail,
      assetFile: render.assetFile,
      videoUrl,
      sentAt: new Date().toISOString()
    });
  } catch (error) {
    await recordNotification({
      jobId: job.id,
      modelKey,
      toEmail,
      assetFile: render.assetFile,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
