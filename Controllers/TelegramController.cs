using System.Text.RegularExpressions;
using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Models;
using HeartPulse.Options;
using HeartPulse.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Telegram.Bot;
using Telegram.Bot.Types;
using Telegram.Bot.Types.ReplyMarkups;

namespace HeartPulse.Controllers;


[ApiController]
[Route("api/telegram/webhook")]
public class TelegramController(
    ITelegramBotClient bot,
    IUserService userService,
    ITelegramCommandDispatcher dispatcher, 
    IOptions<TelegramOptions> opts,
    ILogger<TelegramController> logger)
    : ControllerBase
{
    private readonly TelegramOptions _opts = opts.Value;

    public const string BotUsername = "safe_pulse_test_bot";

    public static readonly ReplyKeyboardMarkup StatusKeyboard = new(new[]
    {
        new KeyboardButton[] { "В безпеці", "SOS", "В укритті" }
    })
    {
        ResizeKeyboard = true,
        OneTimeKeyboard = false
    };

    private static string FormatStatus(UserStatus status) => status switch
    {
        UserStatus.Safe => "✅ В безпеці",
        UserStatus.NeedHelp => "🆘 Потрібна допомога",
        UserStatus.InShelter => "🏠 В укритті",
        _ => "❔ Невідомо"
    };

    private static readonly Regex MdV2EscapeRegex =
        new(@"([_*\[\]()~`>#+\-=|{}.!])", RegexOptions.Compiled);

    private static string EscapeMarkdownV2(string text)
    {
        if (string.IsNullOrEmpty(text))
            return text;

        return MdV2EscapeRegex.Replace(text, "\\$1");
    }
    
    [HttpPost]
    public async Task<IActionResult> Post([FromBody] Update update, CancellationToken ct)
    {
        var secret = Request.Headers["X-Telegram-Bot-Api-Secret-Token"].FirstOrDefault();
        if (!string.IsNullOrEmpty(_opts.WebhookSecretToken) &&
            !string.Equals(secret, _opts.WebhookSecretToken, StringComparison.Ordinal))
        {
            return Unauthorized();
        }

        var msg = update.Message;
        if (msg?.Text is null)
            return Ok();

        var chatId = msg.Chat.Id;
        var userId = msg.From?.Id.ToString() ?? chatId.ToString();
        var username = $"{msg.From?.FirstName ?? msg.Chat.FirstName} {msg.From?.Username ?? msg.Chat.Username}";
        var rawText = msg.Text.Trim();
        var text = rawText.ToLowerInvariant();

        var user = await userService.GetOrCreateAsync(userId, username, chatId, ct);

        var context = new TelegramCommandContext(user, rawText, text, chatId, update);

        var result = await dispatcher.DispatchAsync(context, ct);

        var reply = result?.ReplyText ?? "Доступні команди: /safe, /help, /shelter, /group, /create <назва>, /join <ID_групи>";

        await bot.SendMessage(
            chatId,
            reply,
            replyMarkup: result?.UseStatusKeyboard == true ? StatusKeyboard : null,
            cancellationToken: ct);

        return Ok();
    }
}