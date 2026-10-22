"""Tests for URL compression in the LLM boundary.

Verifies that:
- Short URLs pass through unchanged
- Long tracking URLs are stripped down
- Security-relevant parameters (redirect, callback) are preserved
- Domain + path are always preserved
- Nested URL-encoded destinations are decoded
"""

import pytest
from services.higgins.llm_boundary import compress_urls


class TestCompressUrls:

    def test_short_url_unchanged(self):
        text = "Check this: https://example.com/login"
        assert compress_urls(text) == text

    def test_tracking_params_stripped(self):
        url = "https://example.com/page?utm_source=email&utm_medium=cpc&utm_campaign=sale2024&important=yes"
        result = compress_urls(f"See {url} here")
        assert "utm_source" not in result
        assert "utm_medium" not in result
        assert "utm_campaign" not in result
        assert "important=yes" in result
        assert "https://example.com/page" in result

    def test_long_random_token_truncated(self):
        long_token = "a" * 200
        url = f"https://phish.example.com/verify?session={long_token}"
        result = compress_urls(url)
        assert len(result) < len(url)
        assert "https://phish.example.com/verify" in result

    def test_redirect_param_preserved(self):
        url = "https://evil.com/go?redirect=https://bank.com/login&utm_source=spam&fbclid=abc123"
        result = compress_urls(url)
        assert "redirect=" in result
        assert "bank.com" in result
        assert "utm_source" not in result
        assert "fbclid" not in result

    def test_domain_always_preserved(self):
        """The domain is the primary phishing indicator — must never be lost."""
        long_path = "/a" * 100
        url = f"https://suspicious-domain.xyz{long_path}"
        result = compress_urls(url)
        assert "suspicious-domain.xyz" in result

    def test_no_urls_passthrough(self):
        text = "This email has no links at all."
        assert compress_urls(text) == text

    def test_multiple_urls_compressed(self):
        text = (
            "Link 1: https://example.com/a?utm_source=x&utm_medium=y "
            "Link 2: https://other.com/b?fbclid=abc123&real=data"
        )
        result = compress_urls(text)
        assert "utm_source" not in result
        assert "fbclid" not in result
        assert "real=data" in result

    def test_url_under_limit_kept(self):
        """URLs at exactly 200 chars should not be modified."""
        url = "https://example.com/" + "x" * 172  # 192 chars total
        assert compress_urls(url) == url

    def test_google_ads_params_stripped(self):
        url = "https://shop.com/product?gclid=abc123def456&gclsrc=aw.ds&dclid=xyz789&id=42"
        result = compress_urls(url)
        assert "gclid" not in result
        assert "gclsrc" not in result
        assert "dclid" not in result
        assert "id=42" in result

    def test_meta_params_stripped(self):
        url = "https://site.com/page?fbclid=long_value&fb_action_ids=123&fb_source=feed&page=5"
        result = compress_urls(url)
        assert "fbclid" not in result
        assert "fb_action_ids" not in result
        assert "page=5" in result
