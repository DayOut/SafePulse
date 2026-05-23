using System.Net;
using HeartPulse.DTOs;
using HeartPulse.Events;
using HeartPulse.Exceptions;
using HeartPulse.Hubs;
using HeartPulse.Localization;
using HeartPulse.Models;
using HeartPulse.Options;
using HeartPulse.Repositories.Interfaces;
using HeartPulse.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using Telegram.Bot;
using Telegram.Bot.Exceptions;
using Telegram.Bot.Types.Enums;

namespace HeartPulse.Controllers;

[ApiController]
[Authorize]
[Route("api/groups")]
public class GroupsController(
    IGroupService groupService,
    IUserService userService,
    IGroupStatusRequestRepository statusRequests,
    IHubContext<StatusHub> statusHub,
    ITelegramBotClient bot,
    IServiceScopeFactory scopeFactory,
    IOptions<AppOptions> appOptions,
    IAppLocalizer localizer,
    ILogger<GroupsController> logger) : ControllerBase
{
    private readonly AppOptions _appOptions = appOptions.Value;

    [HttpPost]
    public async Task<ActionResult<GroupDto>> Create([FromBody] CreateGroupRequest request, CancellationToken ct)
    {
        var ownerId = User.GetUserId();
        if (ownerId is null)
            return Unauthorized();

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
        var ownerId = User.GetUserId();
        if (ownerId is null)
            return Unauthorized();

        var groups = await groupService.GetOwnedGroupsAsync(ownerId, ct);
        return Ok(groups.Select(ToDto));
    }

    [HttpGet("{groupId}")]
    public async Task<ActionResult<GroupDto>> GetById(string groupId, CancellationToken ct)
    {
        var ownerId = User.GetUserId();
        if (ownerId is null)
            return Unauthorized();

        var group = await groupService.GetByIdAsync(groupId, ct);
        if (group is null)
            return NotFound();

        if (group.OwnerId != ownerId && !await groupService.IsUserInGroupAsync(groupId, ownerId, ct))
            return StatusCode(StatusCodes.Status403Forbidden);

        return Ok(ToDto(group));
    }

    [HttpPatch("{groupId}")]
    public async Task<ActionResult<GroupDto>> Update(string groupId, [FromBody] UpdateGroupRequest request, CancellationToken ct)
    {
        var ownerId = User.GetUserId();
        if (ownerId is null)
            return Unauthorized();

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
        var ownerId = User.GetUserId();
        if (ownerId is null)
            return Unauthorized();

        var deleted = await groupService.SoftDeleteAsync(groupId, ownerId, ct);
        return deleted ? NoContent() : NotFound();
    }

    [HttpGet("{groupId}/users")]
    public async Task<ActionResult<IEnumerable<GroupMemberDto>>> GetGroupUsers(string groupId, CancellationToken ct)
    {
        var ownerId = User.GetUserId();
        if (ownerId is null)
            return Unauthorized();

        var group = await groupService.GetByIdAsync(groupId, ct);
        if (group is null)
            return NotFound();

        if (group.OwnerId != ownerId && !await groupService.IsUserInGroupAsync(groupId, ownerId, ct))
            return StatusCode(StatusCodes.Status403Forbidden);

        var members = await groupService.GetGroupMembersAsync(groupId, ct);
        var managerCanManage = await groupService.CanManageMembersAsync(groupId, ownerId, ct);
        return Ok(members.Select(member => ToMemberDto(member, group, ownerId, managerCanManage)));
    }

    [HttpPost("{groupId}/users/{userId}")]
    public async Task<IActionResult> AddUserToGroup(string groupId, string userId, CancellationToken ct)
    {
        var ownerId = User.GetUserId();
        if (ownerId is null)
            return Unauthorized();

        var group = await groupService.GetByIdAsync(groupId, ct);
        if (group is null)
            return NotFound("Group was not found");

        if (!await groupService.CanManageMembersAsync(groupId, ownerId, ct))
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
        var ownerId = User.GetUserId();
        if (ownerId is null)
            return Unauthorized();

        var removed = await groupService.RemoveUserFromGroupAsync(groupId, ownerId, userId, ct);
        return removed ? NoContent() : NotFound();
    }

    [HttpPatch("{groupId}/users/{userId}/role")]
    public async Task<IActionResult> UpdateUserRole(string groupId, string userId, [FromBody] UpdateGroupMemberRoleRequest request, CancellationToken ct)
    {
        var ownerId = User.GetUserId();
        if (ownerId is null)
            return Unauthorized();

        try
        {
            var updated = await groupService.UpdateMemberRoleAsync(groupId, ownerId, userId, request.Role, ct);
            return updated ? NoContent() : NotFound();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpPost("{groupId}/status-requests")]
    public async Task<ActionResult<GroupStatusRequestedDto>> RequestStatusUpdate(string groupId, CancellationToken ct)
    {
        var requesterId = User.GetUserId();
        if (requesterId is null)
            return Unauthorized();

        var group = await groupService.GetByIdAsync(groupId, ct);
        if (group is null)
            return NotFound();

        if (group.OwnerId != requesterId && !await groupService.IsUserInGroupAsync(groupId, requesterId, ct))
            return StatusCode(StatusCodes.Status403Forbidden);

        var now = DateTime.UtcNow;
        var latest = await statusRequests.GetLatestForGroupAsync(groupId, ct);

        if (latest is not null && latest.CreatedAt > now.AddMinutes(-1))
        {
            var retryAfterSeconds = Math.Max(1, 60 - (int)(now - latest.CreatedAt).TotalSeconds);
            Response.Headers["Retry-After"] = retryAfterSeconds.ToString();
            return StatusCode(StatusCodes.Status429TooManyRequests, new { RetryAfterSeconds = retryAfterSeconds });
        }

        var requester = await userService.GetByIdAsync(requesterId, ct);
        if (requester is null)
            return NotFound("Requester was not found");

        var request = new GroupStatusRequest
        {
            Id = Guid.NewGuid().ToString(),
            GroupId = group.Id,
            RequestedByUserId = requester.Id,
            RequestedByUserName = requester.UserName,
            CreatedAt = now
        };

        await statusRequests.InsertAsync(request, ct);

        var dto = new GroupStatusRequestedDto
        {
            Id = request.Id,
            GroupId = group.Id,
            GroupName = group.Name,
            RequestedByUserId = requester.Id,
            RequestedByUserName = requester.UserName,
            CreatedAt = request.CreatedAt
        };

        await statusHub.Clients.Group(group.Id).SendAsync("groupStatusRequested", dto, ct);

        _ = ProcessStatusRequestSideEffectsAsync(group.Id, group.Name, requester.UserName);

        return Ok(dto);
    }

    [HttpPost("{groupId}/invites")]
    public async Task<ActionResult<InviteDto>> CreateInvite(string groupId, [FromBody] CreateInviteRequest request, CancellationToken ct)
    {
        var ownerId = User.GetUserId();
        if (ownerId is null)
            return Unauthorized();

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
        var ownerId = User.GetUserId();
        if (ownerId is null)
            return Unauthorized();

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
        var ownerId = User.GetUserId();
        if (ownerId is null)
            return Unauthorized();

        var revoked = await groupService.RevokeInviteAsync(groupId, ownerId, inviteId, ct);
        return revoked ? NoContent() : NotFound();
    }

    private static GroupDto ToDto(Group group) => new()
    {
        Id = group.Id,
        Name = group.Name,
        OwnerId = group.OwnerId,
        CreatedAt = group.CreatedAt ?? group.UpdatedAt ?? DateTime.MinValue,
        UpdatedAt = group.UpdatedAt ?? group.CreatedAt ?? DateTime.MinValue
    };

    private static GroupMemberDto ToMemberDto(GroupMemberInfo member, Group group, string managerId, bool managerCanManage) => new()
    {
        Id = member.User.Id,
        UserName = member.User.UserName,
        Status = member.User.Status.ToString(),
        Role = member.Role,
        CanManage = member.User.Id != group.OwnerId &&
            (group.OwnerId == managerId || (managerCanManage && member.Role == GroupUserRole.Member)),
        LastActiveAt = member.User.LastActiveAt,
        LastSeenOnlineAt = member.User.LastSeenOnlineAt ?? member.User.LastActiveAt
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

    private static readonly SemaphoreSlim _telegramSemaphore = new(25, 25);

    private async Task NotifyTelegramStatusRequestAsync(
        IReadOnlyList<TelegramStatusRequestRecipient> recipients,
        string groupId,
        string groupName,
        string requesterName)
    {
        await Task.WhenAll(recipients.Select(async recipient =>
        {
            var text = BuildStatusRequestText(groupId, groupName, requesterName, recipient.Language);
            await _telegramSemaphore.WaitAsync();
            try
            {
                await bot.SendMessage(
                    recipient.ChatId,
                    text,
                    parseMode: ParseMode.Html,
                    replyMarkup: TelegramController.BuildStatusKeyboard(recipient.Language));
            }
            catch (ApiRequestException ex) when (TelegramMessageTooLongException.IsTelegramMessageTooLong(ex))
            {
                var tooLong = new TelegramMessageTooLongException(recipient.ChatId, text, ex);
                logger.LogError(
                    tooLong,
                    "Telegram status request notification is too long. ChatId: {ChatId}, TextLength: {TextLength}, TextPreview: {TextPreview}",
                    tooLong.ChatId,
                    tooLong.TextLength,
                    tooLong.TextPreview);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to send group status request notification to Telegram chat {ChatId}", recipient.ChatId);
            }
            finally
            {
                _telegramSemaphore.Release();
            }
        }));
    }

    private async Task ProcessStatusRequestSideEffectsAsync(string groupId, string groupName, string requesterName)
    {
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var scopedMemberships = scope.ServiceProvider.GetRequiredService<IGroupMembershipRepository>();
            var scopedStatusService = scope.ServiceProvider.GetRequiredService<IUserStatusService>();

            var members = await scopedMemberships.GetGroupMembersAsync(groupId, CancellationToken.None);
            var resetUsers = new List<AppUser>();

            foreach (var member in members.Where(member => member.User.Status == UserStatus.Safe))
            {
                var updated = await scopedStatusService.ChangeStatusAsync(
                    member.User.Id,
                    UserStatus.Unknown,
                    UserStatusChangeSource.StatusRequestReset,
                    CancellationToken.None);
                if (updated is not null)
                    resetUsers.Add(updated);
            }

            if (resetUsers.Count > 0)
            {
                logger.LogInformation(
                    "Reset {UserCount} safe users to Unknown after status update request in group {GroupId}",
                    resetUsers.Count,
                    groupId);
            }

            var recipients = members
                .Where(member => member.User.TelegramNotificationsEnabled != false)
                .Where(member => member.User.ChatId.HasValue)
                .GroupBy(member => member.User.ChatId!.Value)
                .Select(group => new TelegramStatusRequestRecipient(
                    group.Key,
                    localizer.NormalizeLanguage(group.First().User.Language)))
                .ToList();
            await NotifyTelegramStatusRequestAsync(recipients, groupId, groupName, requesterName);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to process status request side effects for group {GroupId}", groupId);
        }
    }

    private string BuildStatusRequestText(string groupId, string groupName, string requesterName, string language)
    {
        var safeRequesterName = WebUtility.HtmlEncode(requesterName);
        var safeGroupName = WebUtility.HtmlEncode(groupName);
        var groupLink = WebUtility.HtmlEncode(BuildGroupLink(groupId));

        return localizer.Text(
            "telegram.statusRequest",
            language,
            safeRequesterName,
            safeGroupName,
            groupLink);
    }

    private string BuildGroupLink(string groupId)
    {
        var publicBaseUrl = _appOptions.PublicBaseUrl?.Trim().TrimEnd('/');
        if (string.IsNullOrWhiteSpace(publicBaseUrl))
            publicBaseUrl = "http://localhost:5002";

        return $"{publicBaseUrl}/?groupId={Uri.EscapeDataString(groupId)}";
    }

    private sealed record TelegramStatusRequestRecipient(long ChatId, string Language);
}
