using System;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using HeartPulse.Data;
using HeartPulse.Models;
using HeartPulse.Options;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Telegram.Bot;
using Telegram.Bot.Types;
using Microsoft.EntityFrameworkCore;
using Telegram.Bot.Types.Enums;
using Telegram.Bot.Types.ReplyMarkups;
using Group = HeartPulse.Models.Group;
using static System.Net.WebUtility;

namespace HeartPulse.Controllers;


[ApiController]
[Route("api/telegram/webhook")]
public class TelegramController : ControllerBase
{
    private readonly ITelegramBotClient _bot;
    private readonly SafePulseContext _db;
    private readonly TelegramOptions _opts;
    private readonly ILogger<TelegramController> _logger;

    private const string BotUsername = "safe_pulse_test_bot";

    private static readonly ReplyKeyboardMarkup StatusKeyboard = new(new[]
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
    
    private async Task NotifyGroupAsync(AppUser changedUser, CancellationToken ct)
{
    // 1. Знаходимо всі групи, де є користувач зі зміненим статусом
    var groupIds = await _db.GroupUsers
        .Where(gu => gu.UserId == changedUser.Id)
        .Select(gu => gu.GroupId)
        .Distinct()
        .ToListAsync(ct);

    if (groupIds.Count == 0)
        return;

    // 2. Для кожної групи окремо формуємо список її учасників і розсилаємо його
    foreach (var groupId in groupIds)
    {
        var group = await _db.Groups
            .FirstOrDefaultAsync(g => g.Id == groupId, ct);

        if (group is null)
            continue;

        var memberIds = await _db.GroupUsers
            .Where(gu => gu.GroupId == groupId)
            .Select(gu => gu.UserId)
            .ToListAsync(ct);

        if (memberIds.Count == 0)
            continue;

        var members = await _db.Users
            .Where(u => memberIds.Contains(u.Id))
            .ToListAsync(ct);

        if (members.Count == 0)
            continue;

        // 3. Формуємо текст оновленого списку статусів (MarkdownV2-safe)
        var inviteLink = $"https://t.me/{BotUsername}?start=join_{group.Id}";

        // в MarkdownV2 в URL треба екранувати тільки ')'
        var safeInviteLink = inviteLink.Replace(")", "\\)");

        var safeGroupName = EscapeMarkdownV2(group.Name);

        var sb = new StringBuilder();
        sb.AppendLine($"<b>Оновлення статусів у групі</b> " +
                      $"<a href=\"{safeInviteLink}\">{safeGroupName}</a>");
        // sb.AppendLine($"Оновлення статусів у групі \"[{safeGroupName}]({safeInviteLink})\":");
        sb.AppendLine();

        foreach (var member in members)
        {
            var safeUserName = EscapeMarkdownV2(member.UserName ?? member.Id);
            var time = member.LastActiveAt.ToString("HH:mm:ss");
            var safeTime = EscapeMarkdownV2(time);

            var userName = WebUtility.HtmlEncode(member.UserName ?? member.Id);
            if (changedUser.Id == member.Id)
                sb.AppendLine($"• <b><u>{userName}: {FormatStatus(member.Status)} ({time})</u></b>");
            else 
                sb.AppendLine($"• {userName}: {FormatStatus(member.Status)} ({time})");
            // sb.AppendLine($"- {safeUserName}: {FormatStatus(member.Status)} ({safeTime})");
        }

        var text = sb.ToString();

        // 4. Розсилаємо цей список всім учасникам групи
        foreach (var member in members)
        {
            if (member.ChatId == 0)
                continue;

            await _bot.SendMessage(
                member.ChatId,
                text,
                parseMode: ParseMode.Html,
                replyMarkup: StatusKeyboard,
                cancellationToken: ct);
        }
    }
}

    public TelegramController(
        ITelegramBotClient bot,
        SafePulseContext db,
        IOptions<TelegramOptions> opts,
        ILogger<TelegramController> logger)
    {
        _bot = bot;
        _db = db;
        _opts = opts.Value;
        _logger = logger;
    }

    [HttpPost]
    public async Task<IActionResult> Post([FromBody] Update update, CancellationToken ct)
    {
        _logger.LogDebug("Received update from {update}", update);
        // Верифікуємо секрет (рекомендовано Telegram)
        var secret = Request.Headers["X-Telegram-Bot-Api-Secret-Token"].FirstOrDefault();
        if (!string.IsNullOrEmpty(_opts.WebhookSecretToken) &&
            !string.Equals(secret, _opts.WebhookSecretToken, StringComparison.Ordinal))
        {
            return Unauthorized();
        }

        var msg = update.Message;
        if (msg?.Text is null)
            return Ok(); // ігноруємо неконтентні апдейти

        var chatId = msg.Chat.Id;
        var userId = msg.From?.Id.ToString() ?? chatId.ToString();
        var username = $"{msg.From?.FirstName ?? msg.Chat.FirstName} {msg.From?.Username ?? msg.Chat.Username}";
        // var username = (msg.From?.Username + msg.From?.Username) ?? (msg.Chat.Username;
        var rawText = msg.Text.Trim();
        var text   = msg.Text.Trim().ToLowerInvariant();
        _logger.LogInformation("Text {text}", text);

        // Реєстрація користувача якщо треба
        var user = await _db.Users.FindAsync(userId, ct);
        if (user is null)
        {
            user = new AppUser
            {
                Id = userId,
                UserName = username,
                LastActiveAt = DateTime.UtcNow,
                Status = UserStatus.Unknown,
                ChatId = chatId
            };
            await _db.Users.AddAsync(user, ct);
            await _db.SaveChangesAsync(ct);
        }

        string reply;
        switch (rawText)
        {
            case "В безпеці":
            case "/safe":
                user.Status = UserStatus.Safe;
                user.LastActiveAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
                await NotifyGroupAsync(user, ct);
                reply = "✅ Відмічено: ти в безпеці";
                break; 
                
            case "SOS":
            case "/help":
                user.Status = UserStatus.NeedHelp;
                user.LastActiveAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
                await NotifyGroupAsync(user, ct);
                reply = "🆘 Відмічено: потрібна допомога";
                break;
            
            case "В укритті":
            case "/shelter":
                user.Status = UserStatus.InShelter;
                user.LastActiveAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
                await NotifyGroupAsync(user, ct);
                reply = "🏠 Відмічено: в укритті";
                break;

            case "/group":
                var userGroups = await _db.GroupUsers
                    .Where(gu => gu.UserId == userId)
                    .Select(gu => gu.GroupId)
                    .ToListAsync(ct);
                
                var sb = new StringBuilder();
                sb.AppendLine("Твої групи:");
                sb.AppendLine();

                var groupsFiltered = await _db.Groups
                    .Where(g => userGroups.Contains(g.Id))
                    .ToListAsync(ct);
                
                foreach (var group in groupsFiltered)
                {
                    
                    sb.AppendLine($"\\- {group.Name}" + (group.OwnerId == userId ? " \\(Власник\\)" : ""));
                }

                reply = sb.ToString();
                break;
                // if (string.IsNullOrEmpty(user.GroupId))
                // {
                //     // generate short group id based on GUID, e.g. 8 uppercase chars
                //     user.GroupId = Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
                //     user.IsGroupOwner = true;
                //     await _db.SaveChangesAsync(ct);
                // }
                //
                // reply = $"ID твоєї групи: {user.GroupId}\n" +
                //         $"Надішли цей ID цьому ж боту з іншого акаунту командою:\n" +
                //         $"/join {user.GroupId}";
                // break;

            
            default:
                if (rawText.StartsWith("/start", StringComparison.OrdinalIgnoreCase))
                {
                    var comandParts = rawText.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    if (comandParts.Length > 1)
                    {
                        var payload = comandParts[1];

                        if (payload.StartsWith("join_", StringComparison.OrdinalIgnoreCase))
                        {
                            var groupId = payload["join_".Length..];

                            // перевіряємо, що така група існує
                            var group = await _db.Groups.FindAsync(groupId, ct);
                            if (group == null)
                            {
                                reply = "Групу не знайдено";
                                break;
                            }
                            
                            if (_db.GroupUsers.Any(gu => gu.UserId == userId))
                            {
                                reply = "Ви вже в цій групі";
                                break;
                            }

                            // додаємо користувача
                            var gu = new GroupUser
                            {
                                Id = Guid.NewGuid().ToString(),
                                UserId = user.Id,
                                GroupId = groupId
                            };

                            _db.GroupUsers.Add(gu);
                            await _db.SaveChangesAsync(ct);

                            reply = $"Ти успішно приєднався до групи {group.Name}";
                            break;
                        }
                    }

                    reply = "Привіт\\! Я фіксую твій стан безпеки\\. Команди\\: /safe\\, /help\\, /shelter";
                    break;
                }

                // створення нової групи: /create <імʼя групи>
                if (rawText.StartsWith("/create", StringComparison.OrdinalIgnoreCase))
                {
                    var namePart = rawText.Substring("/create".Length).Trim();
                    if (string.IsNullOrWhiteSpace(namePart))
                    {
                        reply = "Будь ласка\\, надішли команду у форматі\\:\n/create Назва моєї групи";
                        break;
                    }

                    // шукаємо, чи вже є така група з таким імʼям
                    var group = await _db.Groups
                        .FirstOrDefaultAsync(g => g.Name == namePart, ct);

                    if (group is null)
                    {
                        group = new Group
                        {
                            Id = Guid.NewGuid().ToString(),
                            Name = namePart,
                            OwnerId = userId
                        };
                        _db.Groups.Add(group);
                    }
                    await _db.SaveChangesAsync(ct);

                    // додаємо користувача до групи, якщо його там ще немає
                    var inGroup = await _db.GroupUsers
                        .AnyAsync(gu => gu.UserId == user.Id && gu.GroupId == group.Id, ct);

                    if (!inGroup)
                    {
                        _db.GroupUsers.Add(new GroupUser
                        {
                            Id = Guid.NewGuid().ToString(),
                            UserId = user.Id,
                            GroupId = group.Id
                        });
                    }

                    await _db.SaveChangesAsync(ct);

                    // формуємо інвайт-посилання у вигляді deep-link
                    var inviteLink = $"https://t.me/{BotUsername}?start=join_{group.Id}";

                    reply = $"Група \"{group.Name}\" готова\\.\n" +
                            "Ти доданий до неї\\. Надішли це посилання іншим, щоб запросити їх:";

                    // надсилаємо окремим повідомленням інвайт-лінк
                    await _bot.SendMessage(
                        chatId,
                        inviteLink,
                        // parseMode: Telegram.Bot.Types.Enums.ParseMode.MarkdownV2,
                        cancellationToken: ct);

                    break;
                }

                // підтримка приєднання до групи через команду /join <GROUP_ID>
                if (rawText.StartsWith("/join", StringComparison.OrdinalIgnoreCase))
                {
                    var parts = rawText.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length < 2)
                    {
                        reply = "Будь ласка, надішли команду у форматі: /join ID_групи";
                    }
                    else
                    {
                        var groupId = parts[1].Trim();

                        var exists = await _db.Groups.AnyAsync(g => g.Id == groupId, ct);
                        if (!exists)
                        {
                            reply = "Групу з таким ID не знайдено\\. Перевір, чи правильно скопійовано код";
                        }
                        else
                        {
                            var inGroup = await _db.GroupUsers
                                .AnyAsync(gu => gu.UserId == user.Id && gu.GroupId == groupId, ct);

                            if (!inGroup)
                            {
                                _db.GroupUsers.Add(new GroupUser
                                {
                                    UserId = user.Id,
                                    GroupId = groupId
                                });
                                await _db.SaveChangesAsync(ct);
                            }

                            reply = $"Ти приєднався до групи {groupId}.";
                        }
                    }
                }
                else
                {
                    reply = "Доступні команди: /safe, /help, /shelter, /group, /create <назва>, /join <ID_групи>";
                }

                break;
        }
        
        await _bot.SendMessage(
            chatId,
            reply,
            replyMarkup: StatusKeyboard,
            // parseMode: Telegram.Bot.Types.Enums.ParseMode.MarkdownV2,
            cancellationToken: ct);
        return Ok();
    }
}