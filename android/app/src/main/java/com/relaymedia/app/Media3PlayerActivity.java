package com.relaymedia.app;

import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.ui.PlayerView;

import com.google.common.collect.ImmutableList;

/**
 * Full-screen AndroidX Media3 / ExoPlayer surface.
 *
 * Plays HLS and direct (progressive) streams with the device's own decoders:
 * MKV containers, Dolby Digital / Digital Plus passthrough, HEVC 10-bit HDR10
 * and Dolby Vision. Tunneled playback is enabled by default, which is what lets
 * Android TV boxes hand frames straight to the display pipeline.
 */
@OptIn(markerClass = UnstableApi.class)
public class Media3PlayerActivity extends AppCompatActivity {

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_SUBTITLE_URL = "subtitleUrl";
    public static final String EXTRA_SUBTITLE_LANG = "subtitleLang";
    public static final String EXTRA_START_MS = "startPositionMs";
    public static final String EXTRA_TUNNELING = "tunneling";

    private ExoPlayer player;
    private PlayerView playerView;
    private TextView errorView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_media3_player);

        playerView = findViewById(R.id.player_view);
        errorView = findViewById(R.id.player_error);

        String url = getIntent().getStringExtra(EXTRA_URL);
        if (url == null || url.isEmpty()) {
            finish();
            return;
        }

        boolean tunneling = getIntent().getBooleanExtra(EXTRA_TUNNELING, true);
        long startMs = getIntent().getLongExtra(EXTRA_START_MS, 0L);

        DefaultTrackSelector trackSelector = new DefaultTrackSelector(this);
        trackSelector.setParameters(
            trackSelector.buildUponParameters()
                .setTunnelingEnabled(tunneling)
                .setPreferredTextLanguage(getIntent().getStringExtra(EXTRA_SUBTITLE_LANG))
        );

        // Fall back to software decoders when a hardware one fails to initialise,
        // so an unusual profile degrades instead of showing a black screen.
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
            .setEnableDecoderFallback(true)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON);

        player = new ExoPlayer.Builder(this, renderers)
            .setTrackSelector(trackSelector)
            .build();
        playerView.setPlayer(player);
        playerView.setKeepContentOnPlayerReset(true);
        playerView.requestFocus();

        MediaItem.Builder item = new MediaItem.Builder().setUri(Uri.parse(url));
        String title = getIntent().getStringExtra(EXTRA_TITLE);
        if (title != null && !title.isEmpty()) {
            item.setMediaMetadata(
                new androidx.media3.common.MediaMetadata.Builder().setTitle(title).build()
            );
        }

        String subtitleUrl = getIntent().getStringExtra(EXTRA_SUBTITLE_URL);
        if (subtitleUrl != null && !subtitleUrl.isEmpty()) {
            MediaItem.SubtitleConfiguration sub = new MediaItem.SubtitleConfiguration.Builder(Uri.parse(subtitleUrl))
                .setMimeType(subtitleUrl.contains(".ass") || subtitleUrl.contains(".ssa")
                    ? MimeTypes.TEXT_SSA
                    : subtitleUrl.contains(".srt") ? MimeTypes.APPLICATION_SUBRIP : MimeTypes.TEXT_VTT)
                .setLanguage(getIntent().getStringExtra(EXTRA_SUBTITLE_LANG))
                .setSelectionFlags(androidx.media3.common.C.SELECTION_FLAG_DEFAULT)
                .build();
            item.setSubtitleConfigurations(ImmutableList.of(sub));
        }

        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                errorView.setText("Playback error: " + error.getErrorCodeName());
                errorView.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED) finish();
            }
        });

        player.setMediaItem(item.build());
        if (startMs > 0) player.seekTo(startMs);
        player.setPlayWhenReady(true);
        player.prepare();
    }

    @Override
    protected void onStop() {
        super.onStop();
        releasePlayer();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        releasePlayer();
    }

    private void releasePlayer() {
        if (player != null) {
            player.release();
            player = null;
            if (playerView != null) playerView.setPlayer(null);
        }
    }
}
