using HeartPulse.Options;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace HeartPulse.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/config")]
public class ConfigController(
    IOptions<TelegramOptions> telegramOptions,
    IOptions<AuthOptions> authOptions) : ControllerBase
{
    [HttpGet]
    public IActionResult Get()
    {
        var token = telegramOptions.Value.BotToken ?? "";
        var botId = token.Contains(':') ? token[..token.IndexOf(':')] : null;
        return Ok(new
        {
            TelegramBotUsername = telegramOptions.Value.BotUsername,
            TelegramBotId = botId,
            EnableDevLogin = authOptions.Value.EnableDevLogin,
        });
    }
}
