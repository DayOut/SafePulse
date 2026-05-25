using HeartPulse.DTOs;
using HeartPulse.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HeartPulse.Controllers;

[ApiController]
[Authorize]
[Route("api/me")]
public class MeController(IGroupService groupService) : ControllerBase
{
    [HttpGet("groups")]
    public async Task<ActionResult<IEnumerable<MyGroupDto>>> GetGroups(CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
            return Unauthorized();

        var groups = await groupService.GetUserGroupsAsync(userId, ct);
        var result = new List<MyGroupDto>(groups.Count);

        foreach (var group in groups.OrderBy(g => g.Name))
        {
            var members = await groupService.GetGroupMembersAsync(group.Id, ct);
            var managerCanManage = await groupService.CanManageMembersAsync(group.Id, userId, ct);
            result.Add(new MyGroupDto
            {
                Id = group.Id,
                Name = group.Name,
                OwnerId = group.OwnerId,
                TelegramInviteLink = group.TelegramInviteLink,
                Members = members.Select(member => ToMemberDto(member, group.OwnerId, userId, managerCanManage)).ToList()
            });
        }

        return Ok(result);
    }

    private static GroupMemberDto ToMemberDto(Models.GroupMemberInfo member, string groupOwnerId, string managerId, bool managerCanManage) => new()
    {
        Id = member.User.Id,
        UserName = member.User.UserName,
        Status = member.User.Status.ToString(),
        Role = member.Role,
        CanManage = member.User.Id != groupOwnerId &&
            (groupOwnerId == managerId || (managerCanManage && member.Role == Models.GroupUserRole.Member)),
        LastActiveAt = member.User.LastActiveAt,
        LastSeenOnlineAt = member.User.LastSeenOnlineAt ?? member.User.LastActiveAt
    };
}
