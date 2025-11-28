using HeartPulse.Models;
using Telegram.Bot.Types;

namespace HeartPulse.DTOs;

public record TelegramCommandContext(
    AppUser User,
    string RawText,
    string NormalizedText,
    long ChatId,
    Update Update);