using HeartPulse.DTOs;
using HeartPulse.Hubs;
using HeartPulse.Models;
using HeartPulse.Services.Interfaces;
using Microsoft.AspNetCore.SignalR;
using MongoDB.Driver;

namespace HeartPulse.Services;

public class ChatService(
    IMongoDatabase database,
    IHubContext<StatusHub> hub) : IChatService
{
    private readonly IMongoCollection<GroupMessage> _messages = database.GetCollection<GroupMessage>("groupMessages");

    public async Task<GroupMessageDto> SendMessageAsync(string groupId, string authorId, string authorName, string text, CancellationToken ct)
    {
        var message = new GroupMessage
        {
            Id = Guid.NewGuid().ToString(),
            GroupId = groupId,
            Kind = MessageKind.User,
            AuthorId = authorId,
            AuthorName = authorName,
            Text = text,
            CreatedAt = DateTime.UtcNow,
        };

        await _messages.InsertOneAsync(message, cancellationToken: ct);
        var dto = ToDto(message);
        await hub.Clients.Group(groupId).SendAsync("chatMessage", dto, ct);
        return dto;
    }

    public async Task<GroupMessageDto> AddSystemMessageAsync(string groupId, SystemEventType eventType, string? userId, string? userName, string? status, CancellationToken ct)
    {
        var message = new GroupMessage
        {
            Id = Guid.NewGuid().ToString(),
            GroupId = groupId,
            Kind = MessageKind.System,
            EventType = eventType,
            EventUserId = userId,
            EventUserName = userName,
            EventStatus = status,
            CreatedAt = DateTime.UtcNow,
        };

        await _messages.InsertOneAsync(message, cancellationToken: ct);
        var dto = ToDto(message);
        await hub.Clients.Group(groupId).SendAsync("chatMessage", dto, ct);
        return dto;
    }

    public async Task<IReadOnlyList<GroupMessageDto>> GetMessagesAsync(string groupId, string? before, int limit, CancellationToken ct)
    {
        limit = Math.Clamp(limit, 1, 100);

        var filter = Builders<GroupMessage>.Filter.And(
            Builders<GroupMessage>.Filter.Eq(x => x.GroupId, groupId),
            Builders<GroupMessage>.Filter.Ne(x => x.IsDeleted, true));

        if (!string.IsNullOrWhiteSpace(before))
        {
            var pivot = await _messages.Find(x => x.Id == before).FirstOrDefaultAsync(ct);
            if (pivot is not null)
                filter &= Builders<GroupMessage>.Filter.Lt(x => x.CreatedAt, pivot.CreatedAt);
        }

        var messages = await _messages
            .Find(filter)
            .Sort(Builders<GroupMessage>.Sort.Descending(x => x.CreatedAt))
            .Limit(limit)
            .ToListAsync(ct);

        messages.Reverse();
        return messages.Select(ToDto).ToList();
    }

    public async Task<GroupMessageDto?> ToggleReactionAsync(string messageId, string userId, string userName, string emoji, CancellationToken ct)
    {
        var message = await _messages.Find(x => x.Id == messageId).FirstOrDefaultAsync(ct);
        if (message is null)
            return null;

        var existing = message.Reactions.FirstOrDefault(r => r.UserId == userId && r.Emoji == emoji);
        UpdateDefinition<GroupMessage> update;

        if (existing is not null)
        {
            update = Builders<GroupMessage>.Update.Pull(x => x.Reactions,
                new MessageReaction { UserId = userId, UserName = userName, Emoji = emoji });
        }
        else
        {
            update = Builders<GroupMessage>.Update.Push(x => x.Reactions,
                new MessageReaction { UserId = userId, UserName = userName, Emoji = emoji });
        }

        var updated = await _messages.FindOneAndUpdateAsync(
            x => x.Id == messageId,
            update,
            new FindOneAndUpdateOptions<GroupMessage> { ReturnDocument = ReturnDocument.After },
            ct);

        if (updated is null)
            return null;

        var dto = ToDto(updated);
        await hub.Clients.Group(updated.GroupId).SendAsync("messageReactionUpdated", dto, ct);
        return dto;
    }

    private static GroupMessageDto ToDto(GroupMessage m) => new()
    {
        Id = m.Id,
        GroupId = m.GroupId,
        Kind = m.Kind.ToString(),
        AuthorId = m.AuthorId,
        AuthorName = m.AuthorName,
        Text = m.Text,
        EventType = m.EventType?.ToString(),
        EventUserId = m.EventUserId,
        EventUserName = m.EventUserName,
        EventStatus = m.EventStatus,
        Reactions = m.Reactions.Select(r => new MessageReactionDto
        {
            UserId = r.UserId,
            UserName = r.UserName,
            Emoji = r.Emoji,
        }).ToList(),
        CreatedAt = m.CreatedAt,
    };
}
