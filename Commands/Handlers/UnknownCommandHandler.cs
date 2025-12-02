using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;

namespace HeartPulse.Commands.Handlers;

public class UnknownCommandHandler: ITelegramCommandHandler
{
    public bool CanHandle(TelegramCommandContext context)
    {
        return true; // handling everything
    }

    public Task<TelegramCommandResult?> HandleAsync(TelegramCommandContext context, CancellationToken ct)
    {
        return Task.FromResult(new TelegramCommandResult(
            "Доступні команди: /safe, /help, /shelter, /group, /create <назва>, /join <ID_групи>"
            ))!;
    }
}