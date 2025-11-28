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
    public async Task NotifyStatusChangedAsync(AppUser changedUser, CancellationToken ct)
    {
        var notifications = await builder.BuildStatusNotificationsAsync(changedUser, ct);

        foreach (var notification in notifications)
        {
            await bot.SendMessage(
                notification.ChatId,
                notification.Text,
                parseMode: ParseMode.Html,
                replyMarkup: TelegramController.StatusKeyboard,
                cancellationToken: ct);
        }
    }

    public async Task SendMessageAsync(string message, AppUser user, CancellationToken ct)
    {
        await bot.SendMessage(
            user.ChatId,
            message,
            parseMode: ParseMode.Html,
            replyMarkup: TelegramController.StatusKeyboard,
            cancellationToken: ct);
    }
}