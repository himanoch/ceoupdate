import crypto from 'node:crypto';
import type { InboundWebhookEvent } from './index.js';

export interface FacebookMessagingSender {
  id: string;
}

export interface FacebookMessagingRecipient {
  id: string;
}

export interface FacebookMessageContent {
  mid: string;
  text?: string;
  is_echo?: boolean;
  quick_reply?: {
    payload: string;
  };
  attachments?: Array<{
    type: string;
    payload: {
      url?: string;
      [key: string]: any;
    };
  }>;
}

export interface FacebookMessagingEntry {
  sender: FacebookMessagingSender;
  recipient: FacebookMessagingRecipient;
  timestamp: number;
  message?: FacebookMessageContent;
  postback?: {
    payload: string;
    title: string;
  };
  delivery?: {
    mids?: string[];
    watermark?: number;
  };
  read?: {
    watermark?: number;
  };
}

export interface FacebookWebhookEntry {
  id: string; // Page ID
  time: number;
  messaging?: FacebookMessagingEntry[];
}

export interface FacebookWebhookPayload {
  object: 'page' | string;
  entry: FacebookWebhookEntry[];
}

export interface FacebookReplyResult {
  success: boolean;
  recipientId: string;
  deliveryMode: 'live_network' | 'synthetic_sandbox';
  statusCode?: number;
  messageId?: string;
  error?: string;
}

/**
 * Validates the HMAC-SHA256 signature from Facebook's `x-hub-signature-256` header.
 * Facebook format: `sha256=<hex_digest>`
 */
export function verifyFacebookSignature(
  rawBody: string | Buffer,
  signatureHeader: string,
  appSecret: string
): boolean {
  if (!rawBody || !signatureHeader || !appSecret) return false;

  const parts = signatureHeader.split('=');
  const signatureHex = parts.length === 2 && parts[0] === 'sha256' ? parts[1] : signatureHeader;

  try {
    const hmac = crypto.createHmac('sha256', appSecret);
    hmac.update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody);
    const expectedHex = hmac.digest('hex');

    const sigBuffer = Buffer.from(signatureHex.toLowerCase(), 'hex');
    const expectedBuffer = Buffer.from(expectedHex.toLowerCase(), 'hex');

    if (sigBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Verifies Facebook Webhook Subscription challenge (handshake during webhook configuration).
 */
export function verifyFacebookWebhookChallenge(params: {
  mode?: string;
  verifyToken?: string;
  challenge?: string;
  expectedVerifyToken: string;
}): { valid: boolean; challenge?: string } {
  const { mode, verifyToken, challenge, expectedVerifyToken } = params;
  if (mode === 'subscribe' && verifyToken && verifyToken === expectedVerifyToken && challenge) {
    return { valid: true, challenge };
  }
  return { valid: false };
}

/**
 * Parses a Facebook Webhook payload into standardized Chatto Bot InboundWebhookEvents.
 */
export function parseFacebookWebhook(
  payload: FacebookWebhookPayload,
  tenantId: string
): InboundWebhookEvent[] {
  const results: InboundWebhookEvent[] = [];
  if (!payload || payload.object !== 'page' || !Array.isArray(payload.entry)) {
    return results;
  }

  for (const entry of payload.entry) {
    if (!Array.isArray(entry.messaging)) continue;

    for (const msgEvent of entry.messaging) {
      // Ignore delivery receipts, read receipts, and echo messages sent by the page itself
      if (msgEvent.delivery || msgEvent.read) continue;
      if (msgEvent.message?.is_echo) continue;

      // Text messages
      if (msgEvent.message && msgEvent.message.text) {
        results.push({
          tenantId,
          channelType: 'facebook',
          channelUserId: msgEvent.sender.id,
          messageId: msgEvent.message.mid || `fb_msg_${msgEvent.timestamp}`,
          text: msgEvent.message.text,
          timestamp: new Date(msgEvent.timestamp).toISOString(),
          replyToken: undefined, // Facebook uses recipient PSID rather than ephemeral replyToken
        });
      }

      // Postback events (e.g. Get Started button or Quick Reply buttons)
      else if (msgEvent.postback && msgEvent.postback.payload) {
        results.push({
          tenantId,
          channelType: 'facebook',
          channelUserId: msgEvent.sender.id,
          messageId: `fb_postback_${msgEvent.timestamp}`,
          text: msgEvent.postback.title || msgEvent.postback.payload,
          timestamp: new Date(msgEvent.timestamp).toISOString(),
        });
      }
    }
  }

  return results;
}

/**
 * Facebook Messenger Channel Adapter for Chatto Bot
 */
export class FacebookChannelAdapter {
  public static verifySignature = verifyFacebookSignature;
  public static verifyChallenge = verifyFacebookWebhookChallenge;
  public static parseWebhook = parseFacebookWebhook;

  /**
   * Dispatches reply message to Facebook Graph Send API (or simulates via synthetic sandbox).
   */
  public static async sendReply(params: {
    recipientId: string;
    text: string;
    citations?: any[];
    pageAccessToken?: string;
  }): Promise<FacebookReplyResult> {
    const { recipientId, text, citations, pageAccessToken } = params;

    // Use synthetic sandbox mode if token is test/mock or missing
    const isLiveToken =
      pageAccessToken &&
      !pageAccessToken.startsWith('mock_') &&
      !pageAccessToken.startsWith('test_') &&
      pageAccessToken.length > 20;

    if (!isLiveToken) {
      return {
        success: true,
        recipientId,
        deliveryMode: 'synthetic_sandbox',
        statusCode: 200,
        messageId: `mock_fb_mid_${Date.now()}`,
      };
    }

    try {
      let formattedText = text;
      if (citations && citations.length > 0) {
        const citationNotes = citations
          .map((c) => `📌 ${c.title}\n${c.snippet} (${c.effectiveDate})`)
          .join('\n\n');
        formattedText = `${text}\n\n---\n${citationNotes}`;
      }

      const response = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: {
            id: recipientId,
          },
          messaging_type: 'RESPONSE',
          message: {
            text: formattedText,
          },
        }),
      });

      const responseData = (await response.json()) as any;

      if (!response.ok) {
        return {
          success: false,
          recipientId,
          deliveryMode: 'live_network',
          statusCode: response.status,
          error: responseData?.error?.message || `HTTP ${response.status}`,
        };
      }

      return {
        success: true,
        recipientId,
        deliveryMode: 'live_network',
        statusCode: response.status,
        messageId: responseData?.message_id,
      };
    } catch (err: any) {
      return {
        success: false,
        recipientId,
        deliveryMode: 'live_network',
        error: err.message || 'Network dispatch error',
      };
    }
  }
}
