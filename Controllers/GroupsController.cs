using HeartPulse.Data;
using HeartPulse.DTOs;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HeartPulse.Controllers;

[ApiController]
[Route("api/groups")]
public class GroupsController : ControllerBase
{
    private readonly SafePulseContext _db;
    public GroupsController(SafePulseContext db)
    {
        _db = db;
    }

    // Повертає юзерів конкретної групи з останніми статусами
    [HttpGet("{groupId}/users")]
    public async Task<ActionResult<IEnumerable<UserDto>>> GetGroupUsers(string groupId, CancellationToken ct)
    {
        // var users = await _db.Users
        //     .Where(u => u.GroupId == groupId)
        //     .OrderByDescending(u => u.LastActiveAt)
        //     .Select(u => new UserDto
        //     {
        //         Id = u.Id,
        //         Status = u.Status.ToString(),
        //         LastActiveAt = u.LastActiveAt
        //     })
        //     .ToListAsync(ct); // можливо варто заюзати не EntityFramework залежність

        return Ok();
    }
    
    [HttpGet("test")]
    public ActionResult<string> Test()
    {
        return Ok("asdusers");
    }
}