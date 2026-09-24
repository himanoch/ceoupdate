import crypto from 'node:crypto';
import type { InboundWebhookEvent } from './index.js';

export interface LineSource {
  type: 'user' | 'group' | 'room';
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface LineMessageContent {
  id: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'location' | 'sticker';
  text?: string;
}

export interface LineEvent {
  type: 'message' | 'follow' | 'unfollow' | 'join' | 'leave' | 'postback';
  mode?: 'active' | 'standby';
  timestamp: number;
  source: LineSource;
  webhookEventId?: string;
  deliveryContext?: {
    isRedelivery: boolean;
  };
  message?: LineMessageContent;
  replyToken?: string;
}

export interface LineWebhookPayload {
  destination?: string;
  events: LineEvent[];
}

export interface LineReplyResult {
  success: boolean;
  replyToken: string;
  deliveryMode: 'live_network' | 'synthetic_sandbox';
  statusCode?: number;
  error?: string;
}

/**
 * Validates the HMAC-SHA256 signature from the `x-line-signature` header.
 */
export function verifyLineSignature(
  rawBody: string | Buffer,
  signature: string,
  channelSecret: string
): boolean {
  if (!rawBody || !signature || !channelSecret) return false;

  const hmac = crypto.createHmac('sha256', channelSecret);
  hmac.update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody);
  const expectedSignature = hmac.digest('base64');

  try {
    const sigBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    if (sigBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Parses a LINE Webhook payload into standardized Chatto Bot InboundWebhookEvents.
 */
export function parseLineWebhook(payload: LineWebhookPayload, tenantId: string): InboundWebhookEvent[] {
  const results: InboundWebhookEvent[] = [];
  if (!payload || !Array.isArray(payload.events)) return results;

  for (const ev of payload.events) {
    if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
      results.push({
        tenantId,
        channelType: 'line',
        channelUserId: ev.source.userId || `line_user_${ev.timestamp}`,
        messageId: ev.message.id || ev.webhookEventId || `line_msg_${ev.timestamp}`,
        text: ev.message.text || '',
        timestamp: new Date(ev.timestamp).toISOString(),
        replyToken: ev.replyToken,
      });
    }
  }

  return results;
}

/**
 * LINE Official Account Channel Adapter for Chatto Bot
 */
export class LineChannelAdapter {
  public static verifySignature = verifyLineSignature;
  public static parseWebhook = parseLineWebhook;

  /**
   * Dispatches reply message to LINE Messaging API (or simulates via synthetic sandbox).
   */
  public static async sendReply(params: {
    replyToken: string;
    text: string;
    citations?: any[];
    channelAccessToken?: string;
  }): Promise<LineReplyResult> {
    const { replyToken, text, citations, channelAccessToken } = params;

    // Use synthetic sandbox mode if token is test/mock or missing
    const isLiveToken =
      channelAccessToken &&
      !channelAccessToken.startsWith('mock_') &&
      !channelAccessToken.startsWith('test_') &&
      channelAccessToken.length > 20;

    if (!isLiveToken) {
      return {
        success: true,
        replyToken,
        deliveryMode: 'synthetic_sandbox',
        statusCode: 200,
      };
    }

    try {
      let formattedText = text;
      if (citations && citations.length > 0) {
        const citationNotes = citations
          .map((c) => `📌 ${c.title}\n${c.snippet} (${c.effectiveDate})`)
          .join('\n\n');
        formattedText = `${text}\n\n---\nข้อมูลอ้างอิง:\n${citationNotes}`;
      }

      const response = await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${channelAccessToken}`,
        },
        body: JSON.stringify({
          replyToken,
          messages: [{ type: 'text', text: formattedText }],
        }),
      });

      if (response.ok) {
        return {
          success: true,
          replyToken,
          deliveryMode: 'live_network',
          statusCode: response.status,
        };
      } else {
        const errText = await response.text();
        return {
          success: false,
          replyToken,
          deliveryMode: 'live_network',
          statusCode: response.status,
          error: errText,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        replyToken,
        deliveryMode: 'live_network',
        error: err.message,
      };
    }
  }
}
