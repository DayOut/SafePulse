using System.ComponentModel.DataAnnotations;
using MongoDB.Bson.Serialization.Attributes;

namespace HeartPulse.Models;

public class Group
{
    [Key]
    [BsonId]
    public string Id { get; set; } = default!; // можеш зберігати свій рядковий Id або ObjectId.ToString()
    public string Name { get; set; } = default!;
    public string OwnerId { get; set; } = default!;
}