using System.Text.RegularExpressions;
using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Exceptions;
using HeartPulse.Localization;
using HeartPulse.Models;
using HeartPulse.Options;
using HeartPulse.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Telegram.Bot;
using Telegram.Bot.Exceptions;
using Telegram.Bot.Types;
using Telegram.Bot.Types.ReplyMarkups;

namespace HeartPulse.Controllers;


[ApiController]
[AllowAnonymous]
[Route("api/telegram/webhook")]
public class TelegramController(
    ITelegramBotClient bot,
    IUserService userService,
    ITelegramCommandDispatcher dispatcher, 
    IOptions<TelegramOptions> opts,
    IAppLocalizer localizer,
    ILogger<TelegramController> logger)
    : ControllerBase
{
    private const int MaxTelegramMessageLength = 3900;
    private readonly TelegramOptions _opts = opts.Value;

    public const string BotUsername = "safe_pulse_test_bot";

    public static readonly ReplyKeyboardMarkup StatusKeyboard = BuildStatusKeyboard("uk");

    public static ReplyKeyboardMarkup BuildStatusKeyboard(string? language)
    {
        var safe = language == "uk" ? "В безпеці" : "Safe";
        var shelter = language == "uk" ? "В укритті" : "In shelter";
        return new ReplyKeyboardMarkup(new[]
        {
            new KeyboardButton[] { safe, "SOS", shelter }
        })
        {
            ResizeKeyboard = true,
            OneTimeKeyboard = false
        };
    }

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
        // var secret = Request.Headers["X-Telegram-Bot-Api-Secret-Token"].FirstOrDefault();
        // if (!string.IsNullOrEmpty(_opts.WebhookSecretToken) &&
        //     !string.Equals(secret, _opts.WebhookSecretToken, StringComparison.Ordinal))
        // {
        //     return Unauthorized();
        // }

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

        var reply = result?.ReplyText ?? localizer.Text("telegram.commands", user.Language);

        var chunks = SplitMessage(reply);
        for (var index = 0; index < chunks.Count; index++)
        {
            var chunk = chunks[index];
            try
            {
                await bot.SendMessage(
                    chatId,
                    chunk,
                    replyMarkup: result?.UseStatusKeyboard == true && index == chunks.Count - 1
                        ? BuildStatusKeyboard(user.Language)
                        : null,
                    cancellationToken: ct);
            }
            catch (ApiRequestException ex) when (TelegramMessageTooLongException.IsTelegramMessageTooLong(ex))
            {
                var tooLong = new TelegramMessageTooLongException(chatId, chunk, ex);
                logger.LogError(
                    tooLong,
                    "Telegram webhook reply chunk is too long. ChatId: {ChatId}, ChunkIndex: {ChunkIndex}, TextLength: {TextLength}, TextPreview: {TextPreview}",
                    tooLong.ChatId,
                    index,
                    tooLong.TextLength,
                    tooLong.TextPreview);
                throw tooLong;
            }
        }

        return Ok();
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
