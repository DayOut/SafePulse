using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HeartPulse.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/config")]
public class ConfigController : ControllerBase
{
    [HttpGet]
    public IActionResult Get() =>
        Ok(new { TelegramBotUsername = TelegramController.BotUsername });
}
