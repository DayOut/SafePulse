using HeartPulse.Controllers;
using HeartPulse.Models;
using HeartPulse.Notifiers.Interfaces;
using Telegram.Bot;
using Telegram.Bot.Types.Enums;

namespace HeartPulse.Notifiers;

public class TelegramGroupNotifier(
    ITelegramBotClient bot,
    IGroupNotificationBuilder builder)
    : IGroupNotifier
{
    private const int MaxTelegramMessageLength = 3900;

    public async Task NotifyStatusChangedAsync(AppUser changedUser, CancellationToken ct)
    {
        var notifications = await builder.BuildStatusNotificationsAsync(changedUser, ct);

        foreach (var notification in notifications)
        {
            foreach (var chunk in SplitMessage(notification.Text))
            {
                await bot.SendMessage(
                    notification.ChatId,
                    chunk,
                    parseMode: ParseMode.Html,
                    replyMarkup: TelegramController.StatusKeyboard,
                    cancellationToken: ct);
            }
        }
    }

    public async Task SendMessageAsync(string message, AppUser user, CancellationToken ct)
    {
        foreach (var chunk in SplitMessage(message))
        {
            await bot.SendMessage(
                user.ChatId,
                chunk,
                parseMode: ParseMode.Html,
                replyMarkup: TelegramController.StatusKeyboard,
                cancellationToken: ct);
        }
    }

    private static IReadOnlyList<string> SplitMessage(string message)
    {
        if (message.Length <= MaxTelegramMessageLength)
            return [message];

        var chunks = new List<string>();
        var current = new System.Text.StringBuilder();

        foreach (var line in message.Split('\n'))
        {
            var lineWithBreak = line + "\n";
            if (current.Length > 0 && current.Length + lineWithBreak.Length > MaxTelegramMessageLength)
            {
                chunks.Add(current.ToString());
                current.Clear();
            }

            if (lineWithBreak.Length <= MaxTelegramMessageLength)
            {
                current.Append(lineWithBreak);
                continue;
            }

            for (var index = 0; index < lineWithBreak.Length; index += MaxTelegramMessageLength)
            {
                var length = Math.Min(MaxTelegramMessageLength, lineWithBreak.Length - index);
                chunks.Add(lineWithBreak.Substring(index, length));
            }
        }

        if (current.Length > 0)
            chunks.Add(current.ToString());

        return chunks;
    }
}
