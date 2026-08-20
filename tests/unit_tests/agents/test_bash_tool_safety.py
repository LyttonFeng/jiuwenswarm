# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

from __future__ import annotations

import pytest
from unittest.mock import MagicMock

from jiuwenswarm.agents.harness.common.tools.bash_tool_safety import (
    _pre_execute_shell_command,
    install_shell_tool_safety_hooks,
    reset_installed_flag,
)


@pytest.fixture(autouse=True)
def _reset_install_flag():
    reset_installed_flag()
    yield
    reset_installed_flag()


def test_pre_execute_blocks_pkill_on_jiuwenswarm_tui() -> None:
    err = _pre_execute_shell_command('pkill -f "jiuwenswarm-tui" 2>/dev/null')
    assert err is not None
    assert "rejected for safety" in err


def test_pre_execute_allows_unrelated_ps() -> None:
    err = _pre_execute_shell_command("ps aux | grep node | head -5")
    assert err is None


def test_pre_execute_blocks_host_chrome_pkill() -> None:
    err = _pre_execute_shell_command("pkill -9 -f 'Google Chrome'")
    assert err is not None
    assert "process termination" in err


def test_pre_execute_blocks_direct_numeric_kill() -> None:
    err = _pre_execute_shell_command("kill -9 4242")
    assert err is not None
    assert "process termination" in err


def test_pre_execute_blocks_direct_browser_launch() -> None:
    err = _pre_execute_shell_command(
        "'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' "
        "--headless about:blank"
    )
    assert err is not None
    assert "direct browser launch" in err


def test_install_wraps_bash_tool_invoke() -> None:
    from openjiuwen.harness.tools.shell.bash._tool import BashTool

    install_shell_tool_safety_hooks()
    assert getattr(BashTool.invoke, "jiuwenswarm_safety_wrapped", False)
    assert getattr(BashTool.stream, "jiuwenswarm_safety_wrapped", False)
    install_shell_tool_safety_hooks()
    assert getattr(BashTool.invoke, "jiuwenswarm_safety_wrapped", False)
    assert getattr(BashTool.stream, "jiuwenswarm_safety_wrapped", False)


@pytest.mark.asyncio
async def test_wrapped_bash_invoke_rejects_before_operation() -> None:
    from openjiuwen.harness.tools.shell.bash._tool import BashTool

    install_shell_tool_safety_hooks()
    operation = MagicMock()
    tool = BashTool(operation)
    output = await tool.invoke({"command": "killall 'Google Chrome'"})

    assert output.success is False
    assert "process termination" in str(output.error)
    operation.shell.assert_not_called()


@pytest.mark.asyncio
async def test_wrapped_bash_stream_rejects_before_operation() -> None:
    from openjiuwen.harness.tools.shell.bash._tool import BashTool

    install_shell_tool_safety_hooks()
    operation = MagicMock()
    tool = BashTool(operation)
    outputs = [
        item
        async for item in tool.stream(
            {"command": "google-chrome --headless about:blank"}
        )
    ]

    assert len(outputs) == 1
    assert outputs[0].success is False
    assert "direct browser launch" in str(outputs[0].error)
    operation.shell.assert_not_called()
