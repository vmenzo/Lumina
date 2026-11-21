package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"

	"lumina-imagehost/internal/config"
)

type R2Driver struct {
	client    *s3.Client
	presigner *s3.PresignClient
	bucket    string
	publicURL string
}

func NewR2Driver(ctx context.Context, cfg *config.Config) (*R2Driver, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.R2AccessKeyID, cfg.R2SecretAccessKey, "")),
		awsconfig.WithRegion("auto"),
	)
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(cfg.R2Endpoint)
		o.UsePathStyle = true
	})
	return &R2Driver{
		client:    client,
		presigner: s3.NewPresignClient(client),
		bucket:    cfg.R2Bucket,
		publicURL: cfg.R2PublicURL,
	}, nil
}

func (d *R2Driver) Name() string { return "r2" }

func (d *R2Driver) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	input := &s3.PutObjectInput{
		Bucket:       aws.String(d.bucket),
		Key:          aws.String(key),
		Body:         r,
		ContentType:  aws.String(contentType),
		CacheControl: aws.String("public, max-age=31536000, immutable"),
	}
	if size > 0 {
		input.ContentLength = aws.Int64(size)
	}
	_, err := d.client.PutObject(ctx, input)
	return err
}

func (d *R2Driver) Get(ctx context.Context, key string) (io.ReadCloser, int64, string, error) {
	out, err := d.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(d.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, 0, "", err
	}
	var sz int64
	if out.ContentLength != nil {
		sz = *out.ContentLength
	}
	ct := "application/octet-stream"
	if out.ContentType != nil {
		ct = *out.ContentType
	}
	return out.Body, sz, ct, nil
}

func (d *R2Driver) Delete(ctx context.Context, key string) error {
	_, err := d.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(d.bucket),
		Key:    aws.String(key),
	})
	return err
}

func (d *R2Driver) Exists(ctx context.Context, key string) (bool, int64, error) {
	out, err := d.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(d.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) && (apiErr.ErrorCode() == "NotFound" || apiErr.ErrorCode() == "NoSuchKey") {
			return false, 0, nil
		}
		return false, 0, err
	}
	var sz int64
	if out.ContentLength != nil {
		sz = *out.ContentLength
	}
	return true, sz, nil
}

func (d *R2Driver) PresignPut(ctx context.Context, key string, contentType string, size int64, ttl time.Duration) (*PresignedUpload, error) {
	input := &s3.PutObjectInput{
		Bucket:        aws.String(d.bucket),
		Key:           aws.String(key),
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(size),
	}
	res, err := d.presigner.PresignPutObject(ctx, input, s3.WithPresignExpires(ttl))
	if err != nil {
		return nil, err
	}
	return &PresignedUpload{
		URL:    res.URL,
		Method: "PUT",
		Headers: map[string]string{
			"Content-Type": contentType,
		},
		Engine: "r2",
	}, nil
}

func (d *R2Driver) PublicURL(key string) string {
	if d.publicURL != "" {
		return fmt.Sprintf("%s/%s", d.publicURL, key)
	}
	return ""
}

func (d *R2Driver) HealthCheck(ctx context.Context) error {
	_, err := d.client.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: aws.String(d.bucket),
	})
	return err
}
