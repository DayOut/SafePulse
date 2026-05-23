using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Events;
using HeartPulse.Localization;
using HeartPulse.Models;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Commands.Handlers;

public class HelpCommandHandler(
    IUserStatusService userStatusService,
    IAppLocalizer localizer)
    : ITelegramCommandHandler
{
    public bool CanHandle(TelegramCommandContext context)
    {
        return context.RawText is "SOS" or "/help";
    }

    public async Task<TelegramCommandResult?> HandleAsync(
        TelegramCommandContext context,
        CancellationToken ct)
    {
        var user = await userStatusService.ChangeStatusAsync(context.User.Id, UserStatus.NeedHelp, UserStatusChangeSource.Telegram, ct);

        return new TelegramCommandResult(localizer.Text("telegram.helpSet", user?.Language ?? context.User.Language));
    }
}
