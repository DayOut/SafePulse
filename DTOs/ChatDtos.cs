using HeartPulse.Models;

namespace HeartPulse.DTOs;

public class GroupMessageDto
{
    public string Id { get; set; } = default!;
    public string GroupId { get; set; } = default!;
    public string Kind { get; set; } = default!;
    public string? AuthorId { get; set; }
    public string? AuthorName { get; set; }
    public string? Text { get; set; }
    public string? EventType { get; set; }
    public string? EventUserId { get; set; }
    public string? EventUserName { get; set; }
    public string? EventStatus { get; set; }
    public List<MessageReactionDto> Reactions { get; set; } = [];
    public DateTime CreatedAt { get; set; }
}

public class MessageReactionDto
{
    public string UserId { get; set; } = default!;
    public string UserName { get; set; } = default!;
    public string Emoji { get; set; } = default!;
}

public class SendMessageRequest
{
    public string Text { get; set; } = default!;
}

public class ToggleReactionRequest
{
    public string Emoji { get; set; } = default!;
}
