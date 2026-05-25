using System.ComponentModel.DataAnnotations;
using MongoDB.Bson.Serialization.Attributes;

namespace HeartPulse.Models;

public class TelegramLinkCode
{
    [Key]
    [BsonId]
    public string Id { get; set; } = default!;
    public string CodeHash { get; set; } = default!;
    public string UserId { get; set; } = default!;
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? ConsumedAt { get; set; }
}
