using HeartPulse.DTOs;
using HeartPulse.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HeartPulse.Controllers;

[ApiController]
[Authorize]
[Route("api/invites")]
public class InvitesController(IGroupService groupService, IUserService userService) : ControllerBase
{
    [HttpGet("{token}")]
    [AllowAnonymous]
    public async Task<ActionResult<InvitePreviewDto>> Resolve(string token, CancellationToken ct)
    {
        var invite = await groupService.GetInviteByTokenAsync(token, ct);
        if (invite is null)
            return NotFound();

        var group = await groupService.GetByIdAsync(invite.GroupId, ct);
        if (group is null)
            return NotFound();

        return Ok(new InvitePreviewDto
        {
            Token = invite.Token,
            GroupId = group.Id,
            GroupName = group.Name,
            IsRevoked = invite.RevokedAt is not null
        });
    }

    [HttpPost("{token}/accept")]
    public async Task<IActionResult> Accept(string token, CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
            return Unauthorized();

        var invite = await groupService.GetInviteByTokenAsync(token, ct);
        if (invite is null)
            return NotFound();

        if (invite.RevokedAt is not null)
            return StatusCode(StatusCodes.Status410Gone, "Invite was revoked");

        var group = await groupService.GetByIdAsync(invite.GroupId, ct);
        if (group is null)
            return NotFound();

        var user = await userService.GetByIdAsync(userId, ct);
        if (user is null)
            return NotFound("Acting user was not found");

        await groupService.JoinUserToGroupAsync(user, group.Id, ct);
        return NoContent();
    }
}
