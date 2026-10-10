import pytest
from scenedetect import SceneManager
from scenedetect.detectors import AdaptiveDetector, ContentDetector, ThresholdDetector

from src.processor import _build_scene_manager


def test_content_detector_used():
    sm = _build_scene_manager(
        detector="content",
        content_threshold=45.0,
        adaptive_threshold=3.0,
        black_threshold=12.0,
        white_threshold=240.0,
        min_scene_len=60,
    )
    assert isinstance(sm, SceneManager)
    assert any(isinstance(d, ContentDetector) for d in sm._detector_list)


def test_adaptive_detector_used():
    sm = _build_scene_manager(
        detector="adaptive",
        content_threshold=45.0,
        adaptive_threshold=3.0,
        black_threshold=12.0,
        white_threshold=240.0,
        min_scene_len=60,
    )
    assert any(isinstance(d, AdaptiveDetector) for d in sm._detector_list)


def test_threshold_detector_uses_both_methods():
    sm = _build_scene_manager(
        detector="threshold",
        content_threshold=45.0,
        adaptive_threshold=3.0,
        black_threshold=12.0,
        white_threshold=240.0,
        min_scene_len=60,
    )
    detectors = sm._detector_list
    assert all(isinstance(d, ThresholdDetector) for d in detectors)
    methods = {d.method for d in detectors}
    assert ThresholdDetector.Method.FLOOR in methods
    assert ThresholdDetector.Method.CEILING in methods
