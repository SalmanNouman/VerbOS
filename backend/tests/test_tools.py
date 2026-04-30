import pytest
import json
import tempfile
import os
from pathlib import Path


class TestPathValidation:
    def test_validate_path_empty(self):
        from tools.path_validation import validate_path
        with pytest.raises(ValueError, match="Path cannot be empty"):
            validate_path("")

    def test_validate_path_blocked(self):
        """On Unix, /etc is blocked. On Windows, C:\\Windows is blocked."""
        from tools.path_validation import validate_path
        blocked_target = "C:\\Windows\\System32" if os.name == "nt" else "/etc"
        with pytest.raises(PermissionError, match="Security Violation"):
            validate_path(blocked_target)

    def test_validate_path_home_allowed(self):
        from tools.path_validation import validate_path
        home = Path.home()
        result = validate_path(str(home))
        assert result == home.resolve()

    def test_validate_path_rejects_sibling_prefix(self, tmp_path, monkeypatch):
        """
        Regression: prior implementation used `str.startswith` on resolved
        paths, so `/tmp/pytest-.../sn-attacker/x.txt` passed when the allow-list
        root was `/tmp/pytest-.../sn`. `Path.is_relative_to` must reject it.
        """
        import tools.path_validation as pv

        allowed_root = tmp_path / "sn"
        allowed_root.mkdir()
        attacker_root = tmp_path / "sn-attacker"
        attacker_root.mkdir()
        target = attacker_root / "x.txt"
        target.write_text("hello")

        monkeypatch.setattr(pv, "SECURITY_CONFIG", {
            "allowed_directories": [allowed_root],
            "blocked_paths": [],
        })

        with pytest.raises(PermissionError, match="Security Violation"):
            pv.validate_path(str(target))

    def test_validate_path_accepts_descendant(self, tmp_path, monkeypatch):
        import tools.path_validation as pv

        allowed_root = tmp_path / "sn"
        allowed_root.mkdir()
        nested = allowed_root / "sub" / "dir"
        nested.mkdir(parents=True)
        target = nested / "ok.txt"
        target.write_text("hello")

        monkeypatch.setattr(pv, "SECURITY_CONFIG", {
            "allowed_directories": [allowed_root],
            "blocked_paths": [],
        })

        assert pv.validate_path(str(target)) == target.resolve()

    def test_validate_write_path_rejects_sibling_prefix(self, tmp_path, monkeypatch):
        """
        The prefix-bypass also affected `validate_write_path`, which validated
        only the parent directory, and the parent's prefix match could pass.
        """
        import tools.path_validation as pv

        allowed_root = tmp_path / "sn"
        allowed_root.mkdir()
        attacker_root = tmp_path / "sn-attacker"
        attacker_root.mkdir()
        target = attacker_root / "new.txt"  # doesn't yet exist

        monkeypatch.setattr(pv, "SECURITY_CONFIG", {
            "allowed_directories": [allowed_root],
            "blocked_paths": [],
        })

        with pytest.raises(PermissionError, match="Security Violation"):
            pv.validate_write_path(str(target))

    def test_validate_write_path_accepts_new_file_in_allowed(self, tmp_path, monkeypatch):
        import tools.path_validation as pv

        allowed_root = tmp_path / "sn"
        allowed_root.mkdir()
        target = allowed_root / "new.txt"  # doesn't yet exist

        monkeypatch.setattr(pv, "SECURITY_CONFIG", {
            "allowed_directories": [allowed_root],
            "blocked_paths": [],
        })

        assert pv.validate_write_path(str(target)) == target.resolve()


class TestFileTool:
    def test_list_directory(self):
        from tools.file_tool import list_directory
        home = str(Path.home())
        result = list_directory.invoke({"path": home})
        items = json.loads(result)
        assert isinstance(items, list)
        assert all("name" in item and "type" in item for item in items)

    def test_read_file_not_found(self):
        from tools.file_tool import read_file
        with pytest.raises(FileNotFoundError):
            read_file.invoke({"path": str(Path.home() / "nonexistent_file_12345.txt")})


class TestShellTool:
    def test_validate_command_allowed(self):
        from tools.shell_tool import validate_command
        validate_command("echo hello")

    def test_validate_command_blocked(self):
        from tools.shell_tool import validate_command
        with pytest.raises(PermissionError, match="not in the whitelist"):
            validate_command("rm -rf /")

    def test_get_command_sensitivity_safe(self):
        from tools.shell_tool import get_command_sensitivity
        assert get_command_sensitivity("echo hello") == "safe"
        assert get_command_sensitivity("git status") == "safe"

    def test_get_command_sensitivity_sensitive(self):
        from tools.shell_tool import get_command_sensitivity
        assert get_command_sensitivity("npm install") == "sensitive"


class TestSystemTool:
    def test_get_system_info(self):
        from tools.system_tool import get_system_info
        result = get_system_info.invoke({})
        info = json.loads(result)
        assert "platform" in info
        assert "memory" in info
        assert "cpu" in info
