using HeartPulse.DTOs;
using HeartPulse.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HeartPulse.Controllers;

[ApiController]
[Authorize]
[Route("api/groups/{groupId}/messages")]
public class ChatController(
    IGroupService groupService,
    IUserService userService,
    IChatService chatService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<GroupMessageDto>>> GetMessages(
        string groupId,
        [FromQuery] string? before,
        [FromQuery] int limit = 50,
        CancellationToken ct = default)
    {
        var userId = User.GetUserId();
        if (userId is null)
            return Unauthorized();

        var group = await groupService.GetByIdAsync(groupId, ct);
        if (group is null)
            return NotFound();

        if (group.OwnerId != userId && !await groupService.IsUserInGroupAsync(groupId, userId, ct))
            return StatusCode(StatusCodes.Status403Forbidden);

        var messages = await chatService.GetMessagesAsync(groupId, before, limit, ct);
        return Ok(messages);
    }

    [HttpPost]
    public async Task<ActionResult<GroupMessageDto>> SendMessage(
        string groupId,
        [FromBody] SendMessageRequest request,
        CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
            return Unauthorized();

        if (string.IsNullOrWhiteSpace(request.Text))
            return BadRequest("Text is required");

        var group = await groupService.GetByIdAsync(groupId, ct);
        if (group is null)
            return NotFound();

        if (group.OwnerId != userId && !await groupService.IsUserInGroupAsync(groupId, userId, ct))
            return StatusCode(StatusCodes.Status403Forbidden);

        var user = await userService.GetByIdAsync(userId, ct);
        if (user is null)
            return Unauthorized();

        var message = await chatService.SendMessageAsync(groupId, userId, user.UserName, request.Text.Trim(), ct);
        return Ok(message);
    }

    [HttpPost("{messageId}/reactions")]
    public async Task<ActionResult<GroupMessageDto>> ToggleReaction(
        string groupId,
        string messageId,
        [FromBody] ToggleReactionRequest request,
        CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
            return Unauthorized();

        if (string.IsNullOrWhiteSpace(request.Emoji))
            return BadRequest("Emoji is required");

        var group = await groupService.GetByIdAsync(groupId, ct);
        if (group is null)
            return NotFound();

        if (group.OwnerId != userId && !await groupService.IsUserInGroupAsync(groupId, userId, ct))
            return StatusCode(StatusCodes.Status403Forbidden);

        var user = await userService.GetByIdAsync(userId, ct);
        if (user is null)
            return Unauthorized();

        var result = await chatService.ToggleReactionAsync(messageId, userId, user.UserName, request.Emoji, ct);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{messageId}")]
    public async Task<IActionResult> DeleteMessage(
        string groupId,
        string messageId,
        CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
            return Unauthorized();

        var result = await chatService.DeleteMessageAsync(messageId, userId, ct);
        return result is null ? NotFound() : NoContent();
    }
}
