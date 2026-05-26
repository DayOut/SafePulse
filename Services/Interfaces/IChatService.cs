using HeartPulse.DTOs;
using HeartPulse.Models;

namespace HeartPulse.Services.Interfaces;

public interface IChatService
{
    Task<GroupMessageDto> SendMessageAsync(string groupId, string authorId, string authorName, string text, CancellationToken ct);
    Task<GroupMessageDto> AddSystemMessageAsync(string groupId, SystemEventType eventType, string? userId, string? userName, string? status, CancellationToken ct);
    Task<IReadOnlyList<GroupMessageDto>> GetMessagesAsync(string groupId, string? before, int limit, CancellationToken ct);
    Task<GroupMessageDto?> ToggleReactionAsync(string messageId, string userId, string userName, string emoji, CancellationToken ct);
    Task<GroupMessageDto?> DeleteMessageAsync(string messageId, string authorId, CancellationToken ct);
    Task<GroupMessageDto?> EditMessageAsync(string messageId, string authorId, string newText, CancellationToken ct);
}
