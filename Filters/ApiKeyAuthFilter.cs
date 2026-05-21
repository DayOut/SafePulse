using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace HeartPulse.Filters;

public class ApiKeyAuthFilter(IConfiguration configuration) : IAsyncActionFilter
{
    private const string HeaderName = "X-Api-Key";

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (context.HttpContext.Request.Path.StartsWithSegments("/api/telegram"))
        {
            await next();
            return;
        }

        var configuredKey = configuration.GetValue<string>("Api:AdminKey");
        if (string.IsNullOrWhiteSpace(configuredKey))
        {
            context.Result = new ObjectResult("Api:AdminKey is not configured") { StatusCode = StatusCodes.Status500InternalServerError };
            return;
        }

        var suppliedKey = context.HttpContext.Request.Headers[HeaderName].FirstOrDefault();
        if (!string.Equals(suppliedKey, configuredKey, StringComparison.Ordinal))
        {
            context.Result = new UnauthorizedResult();
            return;
        }

        await next();
    }
}
