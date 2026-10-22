/**
 * Optional Telegram alert for the site owner.
 *
 * Configured with two environment variables (see .env.example). When either is
 * missing this does nothing, so the app runs fine without a bot. It never throws:
 * an alert that fails must not turn a scrape run into a crash.
 */
export const telegramConfigured = Boolean(
  process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
);

/** Returns true when Telegram accepted the message. */
export async function notifyTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Telegram caps a message at 4096 characters.
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) console.error(`[notify] Telegram responded ${res.status}`);
    return res.ok;
  } catch (err) {
    // Log the reason only — the URL contains the bot token.
    console.error("[notify] Telegram request failed:", err instanceof Error ? err.name : "error");
    return false;
  }
}
