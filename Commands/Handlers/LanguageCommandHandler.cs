using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Localization;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Commands.Handlers;

public class LanguageCommandHandler(IUserService userService, IAppLocalizer localizer) : ITelegramCommandHandler
{
    public bool CanHandle(TelegramCommandContext context)
    {
        return context.RawText.StartsWith("/language", StringComparison.OrdinalIgnoreCase);
    }

    public async Task<TelegramCommandResult?> HandleAsync(TelegramCommandContext context, CancellationToken ct)
    {
        var parts = context.RawText.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2)
        {
            var currentLanguage = localizer.NormalizeLanguage(context.User.Language);
            return new TelegramCommandResult(localizer.Text("telegram.languageCurrent", currentLanguage, currentLanguage));
        }

        var requestedLanguage = parts[1].Trim().ToLowerInvariant();
        if (requestedLanguage is not ("en" or "uk"))
            return new TelegramCommandResult(localizer.Text("telegram.languageInvalid", context.User.Language));

        var user = await userService.SetLanguageAsync(context.User.Id, requestedLanguage, ct);
        var updatedLanguage = user?.Language ?? requestedLanguage;
        return new TelegramCommandResult(
            localizer.Text("telegram.languageUpdated", updatedLanguage),
            UseStatusKeyboard: true);
    }
}
