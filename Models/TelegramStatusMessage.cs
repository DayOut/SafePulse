using System.ComponentModel.DataAnnotations;
using MongoDB.Bson.Serialization.Attributes;

namespace HeartPulse.Models;

public class TelegramStatusMessage
{
    [Key]
    [BsonId]
    public string Id { get; set; } = default!;
    public long ChatId { get; set; }
    public string GroupId { get; set; } = default!;
    public int ChunkIndex { get; set; }
    public int MessageId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
