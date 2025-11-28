using System.ComponentModel.DataAnnotations;
using MongoDB.Bson.Serialization.Attributes;

namespace HeartPulse.Models;

public class GroupUser
{
    [Key]
    [BsonId]
    public string Id { get; set; } = default!; // можеш зберігати свій рядковий Id або ObjectId.ToString()
    public string UserId { get; set; } = default!;
    public string GroupId { get; set; } = default!;
}