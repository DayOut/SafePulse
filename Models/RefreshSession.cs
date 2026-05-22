using System.ComponentModel.DataAnnotations;
using MongoDB.Bson.Serialization.Attributes;

namespace HeartPulse.Models;

public class RefreshSession
{
    [Key]
    [BsonId]
    public string Id { get; set; } = default!;
    public string UserId { get; set; } = default!;
    public string TokenHash { get; set; } = default!;
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string? ReplacedBySessionId { get; set; }
}
