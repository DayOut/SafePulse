using HeartPulse.DTOs;

namespace HeartPulse.Commands.Interfaces;

public interface ITelegramCommandHandler
{
    bool CanHandle(TelegramCommandContext context);
    Task<TelegramCommandResult?> HandleAsync(TelegramCommandContext context, CancellationToken ct);
}