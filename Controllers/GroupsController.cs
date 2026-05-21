using HeartPulse.DTOs;
using HeartPulse.Models;
using HeartPulse.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace HeartPulse.Controllers;

[ApiController]
[Route("api/groups")]
public class GroupsController(IGroupService groupService, IUserService userService) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<GroupDto>> Create([FromBody] CreateGroupRequest request, CancellationToken ct)
    {
        var ownerId = GetActorUserId();
        if (ownerId is null)
            return Unauthorized("X-User-Id header is required");

        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("Group name is required");

        var owner = await userService.GetByIdAsync(ownerId, ct);
        if (owner is null)
            return NotFound("Acting user was not found");

        try
        {
            var group = await groupService.CreateAsync(ownerId, request.Name, ct);
            await groupService.JoinUserToGroupAsync(owner, group.Id, ct);
            return CreatedAtAction(nameof(GetById), new { groupId = group.Id }, ToDto(group));
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(ex.Message);
        }
        catch (Exception ex) when (ex.Message.Contains("already exists", StringComparison.OrdinalIgnoreCase))
        {
            return Conflict(ex.Message);
        }
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<GroupDto>>> GetOwned(CancellationToken ct)
    {
        var ownerId = GetActorUserId();
        if (ownerId is null)
            return Unauthorized("X-User-Id header is required");

        var groups = await groupService.GetOwnedGroupsAsync(ownerId, ct);
        return Ok(groups.Select(ToDto));
    }

    [HttpGet("{groupId}")]
    public async Task<ActionResult<GroupDto>> GetById(string groupId, CancellationToken ct)
    {
        var ownerId = GetActorUserId();
        if (ownerId is null)
            return Unauthorized("X-User-Id header is required");

        var group = await groupService.GetByIdAsync(groupId, ct);
        if (group is null)
            return NotFound();

        if (group.OwnerId != ownerId)
            return StatusCode(StatusCodes.Status403Forbidden);

        return Ok(ToDto(group));
    }

    [HttpPatch("{groupId}")]
    public async Task<ActionResult<GroupDto>> Update(string groupId, [FromBody] UpdateGroupRequest request, CancellationToken ct)
    {
        var ownerId = GetActorUserId();
        if (ownerId is null)
            return Unauthorized("X-User-Id header is required");

        try
        {
            var group = await groupService.UpdateAsync(groupId, ownerId, request.Name, ct);
            return group is null ? NotFound() : Ok(ToDto(group));
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(ex.Message);
        }
    }

    [HttpDelete("{groupId}")]
    public async Task<IActionResult> Delete(string groupId, CancellationToken ct)
    {
        var ownerId = GetActorUserId();
        if (ownerId is null)
            return Unauthorized("X-User-Id header is required");

        var deleted = await groupService.SoftDeleteAsync(groupId, ownerId, ct);
        return deleted ? NoContent() : NotFound();
    }

    [HttpGet("{groupId}/users")]
    public async Task<ActionResult<IEnumerable<GroupMemberDto>>> GetGroupUsers(string groupId, CancellationToken ct)
    {
        var ownerId = GetActorUserId();
        if (ownerId is null)
            return Unauthorized("X-User-Id header is required");

        var group = await groupService.GetByIdAsync(groupId, ct);
        if (group is null)
            return NotFound();

        if (group.OwnerId != ownerId)
            return StatusCode(StatusCodes.Status403Forbidden);

        var users = await groupService.GetGroupUsersAsync(groupId, ct);
        return Ok(users.Select(ToMemberDto));
    }

    [HttpPost("{groupId}/users/{userId}")]
    public async Task<IActionResult> AddUserToGroup(string groupId, string userId, CancellationToken ct)
    {
        var ownerId = GetActorUserId();
        if (ownerId is null)
            return Unauthorized("X-User-Id header is required");

        var group = await groupService.GetByIdAsync(groupId, ct);
        if (group is null)
            return NotFound("Group was not found");

        if (group.OwnerId != ownerId)
            return StatusCode(StatusCodes.Status403Forbidden);

        var user = await userService.GetByIdAsync(userId, ct);
        if (user is null)
            return NotFound("User was not found");

        await groupService.JoinUserToGroupAsync(user, groupId, ct);
        return NoContent();
    }

    [HttpDelete("{groupId}/users/{userId}")]
    public async Task<IActionResult> RemoveUserFromGroup(string groupId, string userId, CancellationToken ct)
    {
        var ownerId = GetActorUserId();
        if (ownerId is null)
            return Unauthorized("X-User-Id header is required");

        var removed = await groupService.RemoveUserFromGroupAsync(groupId, ownerId, userId, ct);
        return removed ? NoContent() : NotFound();
    }

    [HttpPost("{groupId}/invites")]
    public async Task<ActionResult<InviteDto>> CreateInvite(string groupId, [FromBody] CreateInviteRequest request, CancellationToken ct)
    {
        var ownerId = GetActorUserId();
        if (ownerId is null)
            return Unauthorized("X-User-Id header is required");

        try
        {
            var invite = await groupService.CreateInviteAsync(groupId, ownerId, request.Note, ct);
            return CreatedAtAction(nameof(GetInvites), new { groupId }, ToInviteDto(invite));
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(ex.Message);
        }
    }

    [HttpGet("{groupId}/invites")]
    public async Task<ActionResult<IEnumerable<InviteDto>>> GetInvites(string groupId, CancellationToken ct)
    {
        var ownerId = GetActorUserId();
        if (ownerId is null)
            return Unauthorized("X-User-Id header is required");

        var group = await groupService.GetByIdAsync(groupId, ct);
        if (group is null)
            return NotFound();

        if (group.OwnerId != ownerId)
            return StatusCode(StatusCodes.Status403Forbidden);

        var invites = await groupService.GetInvitesAsync(groupId, ownerId, ct);
        return Ok(invites.Select(ToInviteDto));
    }

    [HttpDelete("{groupId}/invites/{inviteId}")]
    public async Task<IActionResult> RevokeInvite(string groupId, string inviteId, CancellationToken ct)
    {
        var ownerId = GetActorUserId();
        if (ownerId is null)
            return Unauthorized("X-User-Id header is required");

        var revoked = await groupService.RevokeInviteAsync(groupId, ownerId, inviteId, ct);
        return revoked ? NoContent() : NotFound();
    }

    private string? GetActorUserId()
    {
        return Request.Headers["X-User-Id"].FirstOrDefault();
    }

    private static GroupDto ToDto(Group group) => new()
    {
        Id = group.Id,
        Name = group.Name,
        OwnerId = group.OwnerId,
        CreatedAt = group.CreatedAt ?? group.UpdatedAt ?? DateTime.MinValue,
        UpdatedAt = group.UpdatedAt ?? group.CreatedAt ?? DateTime.MinValue
    };

    private static GroupMemberDto ToMemberDto(AppUser user) => new()
    {
        Id = user.Id,
        UserName = user.UserName,
        Status = user.Status.ToString(),
        LastActiveAt = user.LastActiveAt
    };

    private InviteDto ToInviteDto(GroupInvite invite) => new()
    {
        Id = invite.Id,
        Token = invite.Token,
        GroupId = invite.GroupId,
        CreatedByUserId = invite.CreatedByUserId,
        Note = invite.Note,
        CreatedAt = invite.CreatedAt,
        RevokedAt = invite.RevokedAt,
        TelegramUrl = $"https://t.me/{TelegramController.BotUsername}?start=join_{invite.Token}",
        ApiUrl = $"{Request.Scheme}://{Request.Host}/api/invites/{invite.Token}"
    };
}
