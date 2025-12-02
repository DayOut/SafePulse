using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Models;
using HeartPulse.Notifiers.Interfaces;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Commands.Handlers;

public class HelpCommandHandler(
    IUserService userService,
    IGroupNotifier groupNotifier)
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
        await userService.UpdateStatusAsync(context.User, UserStatus.NeedHelp, ct);
        await groupNotifier.NotifyStatusChangedAsync(context.User, ct);

        return new TelegramCommandResult("🆘 Відмічено: потрібна допомога");
    }
}