using HeartPulse.Controllers;
using HeartPulse.Models;
using HeartPulse.Notifiers.Interfaces;
using Telegram.Bot;
using MongoDB.Driver;
using Telegram.Bot.Exceptions;
using Telegram.Bot.Types.Enums;

namespace HeartPulse.Notifiers;

public class TelegramGroupNotifier(
    ITelegramBotClient bot,
    IGroupNotificationBuilder builder,
    IMongoDatabase database)
    : IGroupNotifier
{
    private const int MaxTelegramMessageLength = 3900;
    private readonly IMongoCollection<TelegramStatusMessage> _statusMessages = database.GetCollection<TelegramStatusMessage>("telegramStatusMessages");

    public async Task NotifyStatusChangedAsync(AppUser changedUser, CancellationToken ct)
    {
        var notifications = await builder.BuildStatusNotificationsAsync(changedUser, ct);

        foreach (var notification in notifications)
        {
            await UpsertStatusMessagesAsync(notification.ChatId, notification.GroupId, SplitMessage(notification.Text), ct);
        }
    }

    public async Task SendMessageAsync(string message, AppUser user, CancellationToken ct)
    {
        foreach (var chunk in SplitMessage(message))
        {
            await bot.SendMessage(
                user.ChatId,
                chunk,
                parseMode: ParseMode.Html,
                replyMarkup: TelegramController.StatusKeyboard,
                cancellationToken: ct);
        }
    }

    private async Task UpsertStatusMessagesAsync(long chatId, string groupId, IReadOnlyList<string> chunks, CancellationToken ct)
    {
        var existing = await _statusMessages
            .Find(x => x.ChatId == chatId && x.GroupId == groupId)
            .ToListAsync(ct);
        var existingByChunk = existing.ToDictionary(x => x.ChunkIndex);
        var now = DateTime.UtcNow;

        for (var index = 0; index < chunks.Count; index++)
        {
            var chunk = chunks[index];
            if (existingByChunk.TryGetValue(index, out var saved))
            {
                if (await TryEditMessageAsync(chatId, saved.MessageId, chunk, ct))
                {
                    await _statusMessages.UpdateOneAsync(
                        x => x.Id == saved.Id,
                        Builders<TelegramStatusMessage>.Update.Set(x => x.UpdatedAt, now),
                        cancellationToken: ct);
                    continue;
                }
            }

            var sent = await bot.SendMessage(
                chatId,
                chunk,
                parseMode: ParseMode.Html,
                replyMarkup: TelegramController.StatusKeyboard,
                cancellationToken: ct);

            var record = new TelegramStatusMessage
            {
                Id = saved?.Id ?? Guid.NewGuid().ToString(),
                ChatId = chatId,
                GroupId = groupId,
                ChunkIndex = index,
                MessageId = sent.MessageId,
                CreatedAt = saved?.CreatedAt ?? now,
                UpdatedAt = now
            };

            await _statusMessages.ReplaceOneAsync(
                x => x.Id == record.Id,
                record,
                new ReplaceOptions { IsUpsert = true },
                ct);
        }

        foreach (var stale in existing.Where(x => x.ChunkIndex >= chunks.Count))
        {
            await TryDeleteMessageAsync(chatId, stale.MessageId, ct);
            await _statusMessages.DeleteOneAsync(x => x.Id == stale.Id, ct);
        }
    }

    private async Task<bool> TryEditMessageAsync(long chatId, int messageId, string text, CancellationToken ct)
    {
        try
        {
            await bot.EditMessageText(
                chatId,
                messageId,
                text,
                parseMode: ParseMode.Html,
                cancellationToken: ct);
            return true;
        }
        catch (ApiRequestException ex) when (ex.ErrorCode == 400 && ex.Message.Contains("message is not modified", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        catch (ApiRequestException)
        {
            return false;
        }
    }

    private async Task TryDeleteMessageAsync(long chatId, int messageId, CancellationToken ct)
    {
        try
        {
            await bot.DeleteMessage(chatId, messageId, ct);
        }
        catch (ApiRequestException)
        {
        }
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
