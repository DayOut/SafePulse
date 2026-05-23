using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Localization;
using HeartPulse.Models;
using HeartPulse.Services;

namespace HeartPulse.Commands.Handlers;

public class HelpCommandHandler(
    TelegramStatusUpdateService statusUpdateService,
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
        var user = await statusUpdateService.UpdateAsync(context.User, UserStatus.NeedHelp, ct);

        return new TelegramCommandResult(localizer.Text("telegram.helpSet", user?.Language ?? context.User.Language));
    }
}
