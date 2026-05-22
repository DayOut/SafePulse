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
    public string? Role { get; set; } = GroupUserRole.Member;
    public bool? IsDeleted { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

public static class GroupUserRole
{
    public const string Member = "Member";
    public const string Admin = "Admin";
}
