using System.ComponentModel.DataAnnotations;
using MongoDB.Bson.Serialization.Attributes;

namespace HeartPulse.Models;

public class GroupMessage
{
    [Key]
    [BsonId]
    public string Id { get; set; } = default!;
    public string GroupId { get; set; } = default!;
    public MessageKind Kind { get; set; }
    public string? AuthorId { get; set; }
    public string? AuthorName { get; set; }
    public string? Text { get; set; }
    public SystemEventType? EventType { get; set; }
    public string? EventUserId { get; set; }
    public string? EventUserName { get; set; }
    public string? EventStatus { get; set; }
    public List<MessageReaction> Reactions { get; set; } = [];
    public bool? IsDeleted { get; set; }
    public bool? IsEdited { get; set; }
    public DateTime CreatedAt { get; set; }
}

public enum MessageKind { User, System }
public enum SystemEventType { StatusChanged, StatusRequested }

public class MessageReaction
{
    public string UserId { get; set; } = default!;
    public string UserName { get; set; } = default!;
    public string Emoji { get; set; } = default!;
}
