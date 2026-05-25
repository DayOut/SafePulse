using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Commands.Handlers;

public class TelegramNotificationsCommandHandler(IUserService userService) : ITelegramCommandHandler
{
    public bool CanHandle(TelegramCommandContext context)
    {
        return context.RawText.StartsWith("/notifications", StringComparison.OrdinalIgnoreCase);
    }

    public async Task<TelegramCommandResult?> HandleAsync(TelegramCommandContext context, CancellationToken ct)
    {
        var parts = context.RawText.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2)
        {
            var current = context.User.TelegramNotificationsEnabled != false ? "увімкнені" : "вимкнені";
            return new TelegramCommandResult($"Telegram notifications are {current}. Use /notifications on or /notifications off.");
        }

        var value = parts[1].Trim().ToLowerInvariant();
        var enabled = value switch
        {
            "on" or "enable" or "enabled" => true,
            "off" or "disable" or "disabled" => false,
            _ => (bool?)null
        };

        if (enabled is null)
            return new TelegramCommandResult("Use /notifications on or /notifications off.");

        await userService.SetTelegramNotificationsAsync(context.User.Id, enabled.Value, ct);
        return new TelegramCommandResult(enabled.Value
            ? "Telegram notifications enabled."
            : "Telegram notifications disabled. Status buttons still work.");
    }
}
