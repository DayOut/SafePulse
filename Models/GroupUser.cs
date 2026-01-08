using System.ComponentModel.DataAnnotations;
using MongoDB.Bson.Serialization.Attributes;

namespace HeartPulse.Models;

public class GroupUser
{
    [Key]
    [BsonId]
    public string Id { get; set; } = default!;
    public string UserId { get; set; } = default!;
    public string GroupId { get; set; } = default!;
}