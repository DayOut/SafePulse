using System.ComponentModel.DataAnnotations;
using MongoDB.Bson.Serialization.Attributes;

namespace HeartPulse.Models;

public class GroupInvite
{
    [Key]
    [BsonId]
    public string Id { get; set; } = default!;
    public string Token { get; set; } = default!;
    public string GroupId { get; set; } = default!;
    public string CreatedByUserId { get; set; } = default!;
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? RevokedAt { get; set; }
}
