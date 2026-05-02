import pytest

from agent.sensitivity import classify_command, classify_tool
from agent.workers.base_worker import get_tool_sensitivity, pending_placeholder_id
from tools.shell_tool import get_command_sensitivity


class TestClassifyCommand:
    @pytest.mark.parametrize("command", [
        "ls",
        "ls -la",
        "pwd",
        "echo hello",
        "cat README.md",
        "ps aux",
        "whoami",
    ])
    def test_read_only_commands_are_safe(self, command):
        assert classify_command(command) == "safe"

    @pytest.mark.parametrize("command", [
        "git status",
        "git log",
        "git diff --cached",
        "npm list",
        "npm ls",
        "pip list",
        "yarn info react",
    ])
    def test_read_only_subcommands_are_safe(self, command):
        assert classify_command(command) == "safe"

    @pytest.mark.parametrize("command", [
        "curl https://example.com",
        "wget https://example.com/file",
    ])
    def test_network_fetch_commands_are_moderate(self, command):
        assert classify_command(command) == "moderate"

    def test_output_redirection_is_sensitive(self):
        assert classify_command("echo hello") == "safe"
        assert classify_command("echo hello > /tmp/x") == "sensitive"
        assert classify_command("echo hello >> /tmp/x") == "sensitive"
        assert classify_command("cat /etc/hostname > /tmp/x") == "sensitive"

    @pytest.mark.parametrize("command", [
        "ls | sh",
        "ls; rm -rf /",
        "ls && rm -rf /",
        "ls `whoami`",
        "ls $(whoami)",
        "cat < /tmp/evil",
    ])
    def test_unsafe_shell_operators_force_sensitive(self, command):
        assert classify_command(command) == "sensitive"

    @pytest.mark.parametrize("command", [
        "git config core.hooksPath /tmp/evil",
        "git config alias.x '!rm -rf /'",
        "git config user.email attacker@example.com",
    ])
    def test_git_config_is_sensitive(self, command):
        assert classify_command(command) == "sensitive"

    @pytest.mark.parametrize("command", [
        "npm install express",
        "pip install requests",
        "git commit -m 'x'",
        "git push origin main",
        "yarn add react",
        "pnpm install",
        "npx create-react-app foo",
    ])
    def test_mutating_package_and_vcs_commands_are_sensitive(self, command):
        assert classify_command(command) == "sensitive"

    @pytest.mark.parametrize("command", ["", None, "   "])
    def test_invalid_commands_are_sensitive_by_default(self, command):
        assert classify_command(command) == "sensitive"

    def test_unknown_command_is_sensitive_by_default(self):
        assert classify_command("unknown-binary --do-stuff") == "sensitive"


class TestClassifyTool:
    @pytest.mark.parametrize("tool_name", [
        "read_file",
        "list_directory",
        "get_system_info",
        "analyze_code",
        "generate_code",
        "refactor_code",
        "explain_code",
        "summarize_context",
        "extract_facts",
        "analyze_code_context",
    ])
    def test_read_only_and_analysis_tools_are_safe(self, tool_name):
        assert classify_tool(tool_name, {}) == "safe"

    @pytest.mark.parametrize("tool_name", [
        "write_file",
        "create_directory",
        "delete_file",
    ])
    def test_mutating_tools_are_sensitive(self, tool_name):
        assert classify_tool(tool_name, {}) == "sensitive"

    def test_unknown_tool_is_sensitive_by_default(self):
        assert classify_tool("some_new_tool", {}) == "sensitive"

    def test_shell_tool_delegates_to_command_classifier(self):
        assert classify_tool("execute_shell_command", {"command": "ls"}) == "safe"
        assert classify_tool("execute_shell_command", {"command": "curl https://x"}) == "moderate"
        assert classify_tool("execute_shell_command", {"command": "npm install"}) == "sensitive"
        assert classify_tool("execute_shell_command", {"command": "echo x > /tmp/y"}) == "sensitive"

    def test_shell_tool_with_missing_args_is_sensitive(self):
        assert classify_tool("execute_shell_command", None) == "sensitive"
        assert classify_tool("execute_shell_command", {}) == "sensitive"
        assert classify_tool("execute_shell_command", {"command": ""}) == "sensitive"


class TestBackwardsCompatWrappers:
    def test_get_command_sensitivity_from_shell_tool(self):
        assert get_command_sensitivity("ls") == "safe"
        assert get_command_sensitivity("curl https://x") == "moderate"
        assert get_command_sensitivity("npm install") == "sensitive"

    def test_get_tool_sensitivity_from_base_worker(self):
        assert get_tool_sensitivity("read_file", {}) == "safe"
        assert get_tool_sensitivity("write_file", {}) == "sensitive"


class TestPendingPlaceholderId:
    def test_stable_id_for_placeholder(self):
        assert pending_placeholder_id("tc-123") == "pending-approval-tc-123"
        assert pending_placeholder_id("tc-123") == pending_placeholder_id("tc-123")
        assert pending_placeholder_id("tc-123") != pending_placeholder_id("tc-124")
