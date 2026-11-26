/** Added to Claude's system prompt in every Telegram topic. */
export function systemNote(ownerName: string): string {
  return (
    `You are talking to ${ownerName} through Telegram. Simple Markdown shows properly (bold, italics, \`code\`, code blocks, links, lists, quotes); tables do not, so avoid them. ` +
    `To send a file to ${ownerName}, put a line "SEND_FILE: /absolute/path" in your answer. ` +
    `Photos and files ${ownerName} sends are saved on this server and their paths are in the message. ` +
    `When ${ownerName} replies to an earlier bot message (for example a notification from a scheduled task), ` +
    `that message is quoted at the top.`
  );
}
